# Relay Server

## Purpose
The relay server lets one host and many clients communicate over WebSocket for a given game code.

Each game code is deterministically routed to one server instance. If a client connects to the wrong instance, that instance returns an HTTP 307 redirect to the correct server URL.

## Stack
- FastAPI
- Uvicorn
- uv
- In-memory game registry

## Endpoint
- WebSocket route: /connect/{game_code}/{mode}
- mode values:
  - host
  - client

## Routing Model
1. The server hashes game_code with SHA-256.
2. It maps the hash to an index in servers.json.
3. If mapped server != SERVER_URL, the request is denied with HTTP 307 redirect to the mapped server.
4. If mapped server == SERVER_URL, the WebSocket is accepted.

Configuration source:
- servers.json: list of known server base URLs (for example, http://localhost:8001)
- env SERVER_URL: this instance's public/base URL

## Game Lifecycle
Per game code, the server maintains one in-memory game object with:
- host socket (at most one)
- host-ready event
- clients dictionary keyed by client_id

Lifecycle rules:
- Only one host can connect per game.
- Clients may connect before host; they are told to wait.
- When host disconnects, the game is removed and all clients are closed.

## Connection Flow
### Host mode
1. Connect to /connect/{game_code}/host.
2. If host already exists: receive error message, then close.
3. If accepted: receive
   - {"type":"connected"}
4. Host then receives forwarded client RPC calls and replies back to specific client_id.

### Client mode
1. Connect to /connect/{game_code}/client.
2. Server assigns a UUID client_id.
3. If host is not ready yet: receive
   - {"type":"waiting","client_id":"..."}
4. Once host is ready: receive
   - {"type":"connected","client_id":"..."}
5. Client can send RPC messages to host.

## Message Formats
### Client -> Relay (RPC request)
{
  "type": "rpc_request",
  "message_id": "m-123",
  "name": "move",
  "payload": {"x": 1, "y": 2}
}

### Relay -> Host (forwarded request)
{
  "type": "rpc_request",
  "client_id": "uuid",
  "message_id": "m-123",
  "name": "move",
  "payload": {"x": 1, "y": 2}
}

### Host -> Relay (RPC response)
{
  "type": "rpc_response",
  "client_id": "uuid",
  "message_id": "m-123",
  "payload": {"ok": true}
}

### Host -> Relay (broadcast)
{
  "type": "broadcast",
  "name": "round_started",
  "payload": {"round": 1}
}

### Relay -> Client (forwarded response)
{
  "type": "rpc_response",
  "message_id": "m-123",
  "payload": {"ok": true}
}

### Relay -> Clients (forwarded broadcast)
{
  "type": "broadcast",
  "name": "round_started",
  "payload": {"round": 1}
}

### Error/waiting examples
- {"type":"error","message":"game already has a host"}
- {"type":"error","message":"host not available"}
- {"type":"error","message":"game ended"}
- {"type":"waiting","client_id":"uuid"}
- {"type":"connected","client_id":"uuid"}

## Running
From project root:

1) Set servers.json (single-node local example):
[
  "http://localhost:8001"
]

2) Start server:
SERVER_URL=http://localhost:8001 PORT=8001 uv run game-relay

Optional env vars:
- HOST (default: 0.0.0.0)
- PORT (default: 8001)
- SERVER_URL (default: first entry in servers.json)

## Local Test Idea
Use any WebSocket client tool (for example, websocat or browser code):
1. Open host socket to /connect/ABC123/host.
2. Open client socket to /connect/ABC123/client.
3. Send client RPC request.
4. Confirm host receives client_id + message_id.
5. Send host response with same client_id + message_id.
6. Confirm client receives response.
7. Send host broadcast message.
8. Confirm all connected clients receive broadcast.

## Notes and Caveats
- State is in memory only. Restarting the process clears all games.
- No authentication/authorization is currently implemented.
- No persistence, sharding, or external pub/sub is used.
- During waiting state, client should wait for connected before sending RPC messages.
