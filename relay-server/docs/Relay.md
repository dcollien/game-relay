# Relay Protocol

## Purpose
This document describes how external software should communicate with the relay service over WebSocket.

Use this as a protocol contract between:
- a single host for a game code
- one or more clients for the same game code

## Endpoint Contract
- WebSocket path: /connect/{game_code}/{mode}
- mode values:
  - host
  - client

Example paths:
- /connect/ABC123/host
- /connect/ABC123/client

## Session Behavior
- There is at most one active host per game_code.
- Clients may connect before the host.
- Messages are JSON objects.

## Handshake Messages
### Host connected
{
  "type": "connected"
}

### Client waiting for host
{
  "type": "waiting",
  "client_id": "uuid"
}

### Client connected
{
  "type": "connected",
  "client_id": "uuid"
}

## Message Types
### 1) Request/Response RPC
Client sends an RPC request:
{
  "type": "rpc_request",
  "message_id": "m-123",
  "name": "move",
  "payload": {"x": 1, "y": 2}
}

Host receives forwarded RPC request:
{
  "type": "rpc_request",
  "client_id": "uuid",
  "message_id": "m-123",
  "name": "move",
  "payload": {"x": 1, "y": 2}
}

Host sends RPC response:
{
  "type": "rpc_response",
  "client_id": "uuid",
  "message_id": "m-123",
  "payload": {"ok": true}
}

Client receives RPC response:
{
  "type": "rpc_response",
  "message_id": "m-123",
  "payload": {"ok": true}
}

### 2) One-way Command (Client -> Host)
Client sends one-way command:
{
  "type": "command",
  "name": "spawn_enemy",
  "payload": {"kind": "orc"}
}

Host receives forwarded command:
{
  "type": "command",
  "client_id": "uuid",
  "name": "spawn_enemy",
  "payload": {"kind": "orc"}
}

Notes:
- command has no message_id.
- command has no required response.

### 3) Broadcast (Host -> All Clients)
Host sends broadcast:
{
  "type": "broadcast",
  "name": "round_started",
  "payload": {"round": 1}
}

Each client receives:
{
  "type": "broadcast",
  "name": "round_started",
  "payload": {"round": 1}
}

### 4) Binary Frames (Optional)
Binary WebSocket frames are supported as an optional high-performance transport
alongside JSON text frames. Existing JSON-only clients work unchanged.

**Host binary frame → Broadcast to all clients**

The host sends a binary WebSocket frame. The relay broadcasts the raw bytes to
every connected client as a binary frame. No header or framing is added.

**Client binary frame → Forward to host**

A client sends a binary WebSocket frame. The relay prepends a client
identification header and forwards the combined bytes to the host as a binary
frame.

Header format:
```
[1 byte: length of client_id] [client_id UTF-8 bytes] [original payload]
```

The host reads the first byte as N, takes the next N bytes as the UTF-8
client_id, and treats the remainder as the payload.

Notes:
- Binary and JSON text messages can be freely interleaved on the same connection.
- Application-level framing within binary payloads is the game's responsibility.
- Binary frames are subject to the same per-client backpressure as JSON messages.

## Backpressure
Each client has a bounded outbound message buffer (currently 64 messages).
If a client cannot keep up with the send rate, the oldest undelivered messages
are silently dropped. This prevents one slow client from affecting others.

## Error Messages
Possible error payload:
{
  "type": "error",
  "message": "..."
}

Common error cases include:
- host already exists for that game_code
- host not available
- game ended

## Client/Host Recommendations
- Treat message payload as application-defined.
- Use unique message_id values for RPC correlation.
- Wait for connected before sending gameplay messages.
- Handle disconnects and reconnect with a fresh socket.
