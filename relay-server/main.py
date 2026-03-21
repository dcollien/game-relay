import asyncio
import os
import json
import uuid

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from starlette.websockets import WebSocketState

from config import get_target_server, is_local
from game import game_key, get_or_create_game, remove_game, _games as _game_registry, ClientConnection

app = FastAPI()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _send(ws: WebSocket, data: dict) -> None:
    """Send JSON directly to a websocket (used for host messages)."""
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_text(json.dumps(data))
    except Exception:
        pass


async def _close(ws: WebSocket, code: int = 1000, reason: str = "") -> None:
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.close(code=code, reason=reason)
    except Exception:
        pass


def _enqueue(conn: ClientConnection, data: dict) -> None:
    """Enqueue a JSON message for a client. Drops silently if the queue is full."""
    try:
        conn.send_queue.put_nowait(json.dumps(data))
    except asyncio.QueueFull:
        pass


def _enqueue_bytes(conn: ClientConnection, data: bytes) -> None:
    """Enqueue a binary message for a client. Drops silently if the queue is full."""
    try:
        conn.send_queue.put_nowait(data)
    except asyncio.QueueFull:
        pass


async def _client_sender(conn: ClientConnection) -> None:
    """Dedicated per-client sender – drains the outbound queue."""
    try:
        while True:
            msg = await conn.send_queue.get()
            if msg is None:
                break
            if conn.websocket.client_state != WebSocketState.CONNECTED:
                break
            if isinstance(msg, bytes):
                await conn.websocket.send_bytes(msg)
            else:
                await conn.websocket.send_text(msg)
    except Exception:
        pass


async def _receive(ws: WebSocket) -> tuple[str | None, bytes | None]:
    """Receive a text or binary WebSocket frame. Raises WebSocketDisconnect on close."""
    msg = await ws.receive()
    if msg["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(code=msg.get("code", 1000))
    return msg.get("text"), msg.get("bytes")


# ---------------------------------------------------------------------------
# /connect/{game_code}/{mode}
# ---------------------------------------------------------------------------

@app.websocket("/connect/{game_code}/{mode}")
async def connect(websocket: WebSocket, game_code: str, mode: str) -> None:
    # Redirect before accepting the WebSocket upgrade if wrong server
    if not is_local(game_code):
        target = get_target_server(game_code)
        ws_target = target.replace("https://", "wss://").replace("http://", "ws://")
        redirect_url = f"{ws_target}/connect/{game_code}/{mode}"
        await websocket.send_denial_response(
            RedirectResponse(url=redirect_url, status_code=307)
        )
        return

    await websocket.accept()
    key = game_key(game_code)

    if mode == "host":
        await _handle_host(websocket, key)
    elif mode == "client":
        await _handle_client(websocket, key)
    else:
        await _send(websocket, {"type": "error", "message": f"Unknown mode: {mode!r}"})
        await _close(websocket, code=1008)


# ---------------------------------------------------------------------------
# Host
# ---------------------------------------------------------------------------

async def _handle_host(websocket: WebSocket, key: str) -> None:
    game = await get_or_create_game(key)

    if game.host is not None:
        if game.host.client_state != WebSocketState.CONNECTED:
            # Stale host — WebSocket died without clean disconnect
            game.host = None
        else:
            await _send(websocket, {"type": "error", "message": "A game with this code is already in progress"})
            await _close(websocket, code=1008, reason="A game with this code is already in progress")
            return

    game.host = websocket
    game.host_ready.set()
    await _send(websocket, {"type": "connected"})

    try:
        while True:
            text, binary = await _receive(websocket)

            # Binary frame from host → broadcast raw bytes to all clients
            if binary is not None:
                clients_snapshot = list(game.clients.values())
                for conn in clients_snapshot:
                    _enqueue_bytes(conn, binary)
                continue

            if text is None:
                continue

            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "broadcast":
                # Serialize once, enqueue the same string to every client.
                broadcast_json = json.dumps({
                    "type": "broadcast",
                    "name": msg.get("name"),
                    "payload": msg.get("payload"),
                })
                clients_snapshot = list(game.clients.values())
                for conn in clients_snapshot:
                    try:
                        conn.send_queue.put_nowait(broadcast_json)
                    except asyncio.QueueFull:
                        pass
                continue

            client_id = msg.get("client_id")
            if not client_id:
                continue

            conn = game.clients.get(client_id)
            if conn is None:
                continue  # client already disconnected

            _enqueue(conn, {
                "type": "rpc_response",
                "message_id": msg.get("message_id"),
                "payload": msg.get("payload"),
            })

    except WebSocketDisconnect:
        pass
    finally:
        game.host = None
        clients_snapshot = dict(game.clients)
        await remove_game(key)
        for conn in clients_snapshot.values():
            try:
                conn.send_queue.put_nowait(None)
            except asyncio.QueueFull:
                pass
            await _close(conn.websocket, code=1001, reason="host disconnected")


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

async def _handle_client(websocket: WebSocket, key: str) -> None:
    client_id = str(uuid.uuid4())
    game = await get_or_create_game(key)
    conn = ClientConnection(websocket=websocket)
    game.clients[client_id] = conn
    sender_task = asyncio.create_task(_client_sender(conn))

    try:
        if not game.host_ready.is_set():
            _enqueue(conn, {"type": "waiting", "client_id": client_id})

            while not game.host_ready.is_set():
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=0.25)
                    return
                except asyncio.TimeoutError:
                    continue
                except WebSocketDisconnect:
                    return

            if key not in _game_registry:
                _enqueue(conn, {"type": "error", "message": "game ended"})
                return

        _enqueue(conn, {"type": "connected", "client_id": client_id})

        while True:
            text, binary = await _receive(websocket)

            # Binary frame from client → forward to host with client_id header
            if binary is not None:
                if game.host is not None and game.host.client_state == WebSocketState.CONNECTED:
                    cid = client_id.encode()
                    try:
                        await game.host.send_bytes(bytes([len(cid)]) + cid + binary)
                    except Exception:
                        pass
                continue

            if text is None:
                continue

            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue

            if game.host is None:
                _enqueue(conn, {"type": "error", "message": "host not available"})
                continue

            if msg.get("type") == "command":
                await _send(game.host, {
                    "type": "command",
                    "client_id": client_id,
                    "name": msg.get("name"),
                    "payload": msg.get("payload"),
                })
                continue

            await _send(game.host, {
                "type": "rpc_request",
                "client_id": client_id,
                "message_id": msg.get("message_id"),
                "name": msg.get("name"),
                "payload": msg.get("payload"),
            })

    except WebSocketDisconnect:
        pass
    finally:
        game.clients.pop(client_id, None)
        try:
            conn.send_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass
        sender_task.cancel()
        try:
            await sender_task
        except (asyncio.CancelledError, Exception):
            pass


def run() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host=host, port=port)


if __name__ == "__main__":
    run()
