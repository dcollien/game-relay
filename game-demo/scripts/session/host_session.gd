class_name HostSession
extends Session
## Network host session — runs game logic locally, broadcasts state via relay.
##
## The host is authoritative: it validates moves, updates the board,
## and broadcasts every change to connected clients.

var relay_url: String
var game_code: String
var ai_enabled := false

## Grace window in seconds. When a dot is claimed, later claims with an
## earlier timestamp can steal it during this window.
var conflict_window := 0.2

var _relay = null
var _ai: AiPlayer = null
var _pending_claims: Dictionary = {}  # index -> {player_id, clicked_at, timer}

# =============================================================================
#  Interface
# =============================================================================

func start_session() -> void:
	super.start_session()
	_relay = RelayHost.new()
	_relay.clock_sync_enabled = true
	add_child(_relay)

	_relay.connected.connect(_on_connected)
	_relay.disconnected.connect(_on_disconnected)
	_relay.error.connect(func(msg: String): log_message.emit("ERROR: %s" % msg))
	_relay.debug.connect(func(msg: String): log_message.emit("[relay] %s" % msg))
	_relay.command_received.connect(_on_command_received)

	# Register RPCs the host can answer
	_relay.register_rpc("get_game_state", func(_payload: Dictionary):
		return {"board": board, "scores": scores, "remaining": remaining(), "game_over": game_over}
	)
	_relay.register_rpc("get_leaderboard", func(_payload: Dictionary):
		return {"leaderboard": _build_leaderboard(), "remaining": remaining(), "game_over": game_over}
	)

	if _relay.connect_to_relay(relay_url, game_code):
		log_message.emit("Host connecting...")


func stop_session() -> void:
	_clear_pending_claims()
	if _ai:
		_ai.stop()
		_ai.queue_free()
		_ai = null
	if _relay:
		_relay.close_connection()
		_relay.queue_free()
		_relay = null
	session_ended.emit()


func is_active() -> bool:
	return _relay != null and _relay.is_relay_connected()


func get_player_id() -> String:
	return "host"


func get_role_name() -> String:
	return "host"


func collect_dot(index: int) -> void:
	_handle_collect("host", index, Time.get_ticks_msec() / 1000.0)


func request_leaderboard() -> void:
	leaderboard_ready.emit(_build_leaderboard())


func sync_state() -> void:
	if _relay and is_active():
		var payload := {"board": board, "scores": scores, "remaining": remaining(), "game_over": game_over}
		if _relay.broadcast("full_state", payload):
			log_message.emit("Broadcast full state to all clients")

# =============================================================================
#  Relay callbacks
# =============================================================================

func _on_connected() -> void:
	log_message.emit("Host connected — new game started")
	_reset_board()
	if ai_enabled:
		_ai = AiPlayer.new()
		_ai.move_requested.connect(func(index: int): _handle_collect("ai", index, Time.get_ticks_msec() / 1000.0))
		add_child(_ai)
		_ai.start(board)
		log_message.emit("AI opponent added")
	session_started.emit()
	state_changed.emit()


func _on_disconnected() -> void:
	log_message.emit("Disconnected")
	session_ended.emit()


func _on_command_received(from_client_id: String, command_name: String, payload: Dictionary) -> void:
	if command_name == "collect":
		var clicked_at := float(payload.get("clicked_at", Time.get_ticks_msec() / 1000.0))
		_handle_collect(from_client_id, int(payload.get("index", -1)), clicked_at)
	else:
		log_message.emit("Unknown command: %s" % command_name)

# =============================================================================
#  Game logic
# =============================================================================

func _handle_collect(player_id: String, index: int, clicked_at: float = -1.0) -> void:
	if game_over or index < 0 or index >= TOTAL_DOTS:
		return

	# Default to current host time if no timestamp provided
	if clicked_at < 0.0:
		clicked_at = Time.get_ticks_msec() / 1000.0

	# If the dot is unclaimed, claim it and start a grace window
	if board[index] == "":
		_apply_claim(player_id, index)
		if conflict_window > 0.0:
			var timer := get_tree().create_timer(conflict_window)
			_pending_claims[index] = {"player_id": player_id, "clicked_at": clicked_at, "timer": timer}
			timer.timeout.connect(_finalize_claim.bind(index))
		return

	# If the dot is already claimed and inside the grace window,
	# check if this claim has an earlier timestamp
	if _pending_claims.has(index):
		var pending: Dictionary = _pending_claims[index]
		if clicked_at < float(pending["clicked_at"]):
			# Earlier click — reassign the dot
			var old_owner: String = pending["player_id"]
			scores[old_owner] = int(scores.get(old_owner, 0)) - 1
			if int(scores.get(old_owner, 0)) <= 0:
				scores.erase(old_owner)
			board[index] = player_id
			scores[player_id] = int(scores.get(player_id, 0)) + 1
			_pending_claims[index]["player_id"] = player_id
			_pending_claims[index]["clicked_at"] = clicked_at
			log_message.emit("Conflict on dot %d: reassigned to %s (earlier click)" % [index, player_id])
			_broadcast_correction(index, player_id)
			state_changed.emit()


func _apply_claim(player_id: String, index: int) -> void:
	board[index] = player_id
	scores[player_id] = int(scores.get(player_id, 0)) + 1

	var dots_left := remaining()

	if dots_left == 0:
		game_over = true
		var winner := leader_id()
		if _ai:
			_ai.notify_game_over()
		if _relay:
			_relay.broadcast("game_over", {
				"board": board, "scores": scores, "remaining": 0,
				"winner": winner, "game_over": true,
			})
		game_ended.emit(winner)
	else:
		if _relay:
			_relay.broadcast("dot_collected", {
				"index": index, "owner": player_id,
				"score": int(scores[player_id]), "remaining": dots_left,
			})

	state_changed.emit()


func _broadcast_correction(index: int, new_owner: String) -> void:
	if _relay:
		_relay.broadcast("dot_corrected", {
			"index": index, "owner": new_owner,
			"score": int(scores.get(new_owner, 0)), "remaining": remaining(),
		})


func _finalize_claim(index: int) -> void:
	_pending_claims.erase(index)


func _clear_pending_claims() -> void:
	_pending_claims.clear()
