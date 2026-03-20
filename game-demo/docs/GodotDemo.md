# Godot Relay Demo

10x10 multiplayer Dot Collector demo using split `RelayHost` and `RelayClient` classes.

## Scene
- **Main scene:** `res://scenes/Main.tscn`
- **Script:** `res://scripts/demo_network.gd`
- **Libraries:** 
  - `res://scripts/relay/relay_host.gd`
  - `res://scripts/relay/relay_client.gd`

## What it teaches
- Host-authoritative gameplay with 100 collectible dots
- Commands for player actions (`collect`)
- Broadcasts for shared world updates (`dot_collected`, `full_state`, `game_over`)
- RPC queries for pull-style data (`get_game_state`, `get_leaderboard`)
- Game-over flow when all dots are collected

## Quick test
1. **Run 1st instance:** Click "Connect as Host"
   - Host initializes a fresh 10x10 board
   - Host registers RPC handlers for `"get_game_state"` and `"get_leaderboard"`
2. **Run 2nd instance:** Click "Connect as Client"
   - Client immediately uses RPC `get_game_state` to sync current board
3. **Click any dot on the client**
   - Client sends command `collect { index }`
   - Host validates the move and broadcasts `dot_collected`
4. **Both instances see the same dot become claimed instantly**
5. **Click "Show Leaderboard (RPC)" on client**
   - Client uses RPC `get_leaderboard`
   - Host returns sorted scores as a direct response
6. **Keep collecting dots until none remain**
   - Host broadcasts `game_over` with the winner

## Code flow: Host (RelayHost)

```gdscript
relay = RelayHost.new()
add_child(relay)

# Register RPC handler (auto-responds)
relay.register_rpc("get_game_state", func(_payload):
    return {"board": board, "scores": scores, "game_over": game_over}
)
relay.register_rpc("get_leaderboard", func(_payload):
    return {"leaderboard": sorted_scores}
)

relay.command_received.connect(_on_command)
relay.connect_to_relay(url, code)

func _on_command(client_id: String, name: String, payload: Dictionary):
    if name == "collect":
        var index := int(payload.get("index", -1))
        if board[index] == "":
            board[index] = client_id
            scores[client_id] = int(scores.get(client_id, 0)) + 1
            relay.broadcast("dot_collected", {"board": board, "scores": scores, "index": index})
```

## Code flow: Client (RelayClient)

```gdscript
relay = RelayClient.new()
add_child(relay)

relay.broadcast_received.connect(_on_broadcast)
relay.connect_to_relay(url, code)

func on_dot_clicked(index: int):
    relay.send("collect", {"index": index})  # Fire-and-forget command

func show_leaderboard():
    relay.call_rpc("get_leaderboard", {}).completed.connect(func(payload):
        print(payload["leaderboard"])
    )

func _on_broadcast(name: String, payload: Dictionary):
    if name == "dot_collected":
        board = payload["board"]
        scores = payload["scores"]
```

## Key design patterns

- **Command = player intent:** `collect` is an action from one player
- **Broadcast = world truth:** host pushes accepted state changes to everyone
- **RPC = query/inspect:** leaderboard and full-state sync are request-response pulls
- **Host authority:** host validates claims and decides when game ends
- **Deterministic finish:** game ends exactly when all 100 dots are claimed

## To reuse
Copy `relay_host.gd` and `relay_client.gd` into your project's relay folder. See [RelayLibrary.md](RelayLibrary.md) for full API.
