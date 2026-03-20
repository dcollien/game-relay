# Relay Library

This project uses two role-specific relay classes:

- `RelayHost` for authoritative host logic
- `RelayClient` for client input and queries

Files:

- `res://scripts/relay/relay_host.gd`
- `res://scripts/relay/relay_client.gd`

## RelayHost

Use this on the host instance. It receives client commands, serves RPC requests, and broadcasts world state.

### API

```gdscript
func connect_to_relay(relay_url: String, game_code: String) -> bool
func close_connection() -> void
func is_relay_connected() -> bool
func register_rpc(name: String, handler: Callable) -> void
func broadcast(message_name: String, data: Dictionary = {}) -> bool
```

### Signals

- `connected()`
- `disconnected()`
- `error(message: String)`
- `command_received(client_id: String, name: String, payload: Dictionary)`

### Host Example

```gdscript
var relay := RelayHost.new()
add_child(relay)

relay.command_received.connect(_on_command)
relay.error.connect(_on_error)

relay.register_rpc("get_game_state", func(_payload: Dictionary):
	return {
		"board": board,
		"scores": scores,
		"game_over": game_over,
	}
)

relay.register_rpc("get_leaderboard", func(_payload: Dictionary):
	return {"leaderboard": _build_leaderboard()}
)

relay.connect_to_relay("wss://your-relay/connect", "ABC123")

func _on_command(client_id: String, name: String, payload: Dictionary) -> void:
	if name == "collect":
		var index := int(payload.get("index", -1))
		# validate and apply change...
		relay.broadcast("dot_collected", {
			"index": index,
			"owner": client_id,
			"board": board,
			"scores": scores,
		})
```

## RelayClient

Use this on client instances. It sends commands and makes request-response RPC calls.

### API

```gdscript
func connect_to_relay(relay_url: String, game_code: String) -> bool
func close_connection() -> void
func is_relay_connected() -> bool
func send(command_name: String, data: Dictionary = {}) -> bool
func call_rpc(name: String, payload: Dictionary = {}, timeout_seconds: float = -1.0) -> RPCCall
```

`call_rpc` returns an `RPCCall` object with:

- `completed(payload: Dictionary)`
- `timed_out()`

### Signals

- `connected(client_id: String)`
- `disconnected()`
- `error(message: String)`
- `broadcast_received(name: String, payload: Dictionary)`

### Client Example

```gdscript
var relay := RelayClient.new()
add_child(relay)

relay.broadcast_received.connect(_on_broadcast)
relay.error.connect(_on_error)

relay.connect_to_relay("wss://your-relay/connect", "ABC123")

func click_cell(index: int) -> void:
	relay.send("collect", {"index": index})

func show_leaderboard() -> void:
	var rpc_call = relay.call_rpc("get_leaderboard", {})
	rpc_call.completed.connect(func(payload: Dictionary):
		print(payload.get("leaderboard", []))
	)
	rpc_call.timed_out.connect(func():
		push_warning("Leaderboard request timed out")
	)
```

## Command vs Broadcast vs RPC

- Command: player intent from client to host (for example `collect`)
- Broadcast: authoritative state update from host to all clients (for example `dot_collected`, `game_over`)
- RPC: client query expecting a direct response (for example `get_game_state`, `get_leaderboard`)

## Notes

- Use `close_connection()` in game code; do not define or rely on `disconnect()` in relay classes because it conflicts with `Node.disconnect(...)`.
- Keep game validation on host side and treat client commands as requests, not truth.