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
