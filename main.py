import asyncio
import os
import json
import uuid

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from starlette.websockets import WebSocketState

from config import get_target_server, is_local
from game import game_key, get_or_create_game, remove_game, _games as _game_registry

app = FastAPI()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _send(ws: WebSocket, data: dict) -> None:
    """Send JSON, silently ignoring already-closed sockets."""
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
        await _send(websocket, {"type": "error", "message": "game already has a host"})
        await _close(websocket, code=1008, reason="game already has a host")
        return

    game.host = websocket
    game.host_ready.set()
    await _send(websocket, {"type": "connected"})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            # Expected from host: {"client_id": "...", "message_id": "...", "payload": {...}}
            client_id = msg.get("client_id")
            if not client_id:
                continue

            target_ws = game.clients.get(client_id)
            if target_ws is None:
                continue  # client already disconnected

            await _send(target_ws, {
                "type": "rpc_response",
                "message_id": msg.get("message_id"),
                "payload": msg.get("payload"),
            })

    except WebSocketDisconnect:
        pass
    finally:
        # Tear down the entire game and close all connected clients
        game.host = None
        clients_snapshot = dict(game.clients)
        await remove_game(key)
        for client_ws in clients_snapshot.values():
            await _close(client_ws, code=1001, reason="host disconnected")


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

async def _handle_client(websocket: WebSocket, key: str) -> None:
    client_id = str(uuid.uuid4())
    game = await get_or_create_game(key)
    game.clients[client_id] = websocket

    try:
        if not game.host_ready.is_set():
            await _send(websocket, {"type": "waiting", "client_id": client_id})

            # Wait for host OR for client to disconnect, whichever comes first
            wait_task = asyncio.create_task(game.host_ready.wait())
            recv_task = asyncio.create_task(websocket.receive_text())

            done, pending = await asyncio.wait(
                {wait_task, recv_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()

            if recv_task in done:
                # Client sent something or disconnected before host arrived
                game.clients.pop(client_id, None)
                return

            # If the game was removed while waiting (e.g. stale state), bail out
            if key not in _game_registry:
                await _send(websocket, {"type": "error", "message": "game ended"})
                await _close(websocket, code=1001)
                game.clients.pop(client_id, None)
                return

        await _send(websocket, {"type": "connected", "client_id": client_id})

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if game.host is None:
                await _send(websocket, {"type": "error", "message": "host not available"})
                continue

            # Forward RPC call to host, injecting client_id
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


def run() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host=host, port=port)


if __name__ == "__main__":
    run()
