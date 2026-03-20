class_name ClientSession
extends Session
## Network client session — sends commands and RPCs to the host via relay.
##
## The client maintains a local mirror of the game state, updated from
## host broadcasts. Moves are sent as fire-and-forget commands with
## optimistic local updates that roll back on send failure.

var relay_url: String
var game_code: String
var _relay = null
var _client_id := ""

# =============================================================================
#  Interface
# =============================================================================

func start_session() -> void:
	super.start_session()
	_relay = RelayClient.new()
	_relay.clock_sync_enabled = true
	add_child(_relay)

	_relay.connected.connect(_on_connected)
	_relay.disconnected.connect(_on_disconnected)
	_relay.error.connect(func(msg: String): log_message.emit("ERROR: %s" % msg))
	_relay.debug.connect(func(msg: String): log_message.emit("[relay] %s" % msg))
	_relay.broadcast_received.connect(_on_broadcast_received)

	if _relay.connect_to_relay(relay_url, game_code):
		log_message.emit("Client connecting...")


func stop_session() -> void:
	if _relay:
		_relay.close_connection()
		_relay.queue_free()
		_relay = null
	_client_id = ""
	session_ended.emit()


func is_active() -> bool:
	return _relay != null and _relay.is_relay_connected()


func get_player_id() -> String:
	return _client_id


func get_role_name() -> String:
	return "client"


func collect_dot(index: int) -> void:
	if game_over or index < 0 or index >= TOTAL_DOTS:
		return
	if board[index] != "":
		return

	# Optimistic update — show immediately, roll back if send fails
	board[index] = _client_id
	scores[_client_id] = int(scores.get(_client_id, 0)) + 1
	state_changed.emit()

	if not _relay.send("collect", {"index": index, "clicked_at": _relay.host_time()}):
		board[index] = ""
		scores[_client_id] = int(scores.get(_client_id, 0)) - 1
		if int(scores.get(_client_id, 0)) <= 0:
			scores.erase(_client_id)
		state_changed.emit()


func request_leaderboard() -> void:
	log_message.emit("Requesting leaderboard...")
	var rpc_call = _relay.call_rpc("get_leaderboard", {})
	if rpc_call == null:
		return
	rpc_call.completed.connect(func(payload: Dictionary):
		var entries: Variant = payload.get("leaderboard", [])
		if typeof(entries) == TYPE_ARRAY:
			leaderboard_ready.emit(entries)
		else:
			log_message.emit("Invalid leaderboard response")
	)
	rpc_call.timed_out.connect(func():
		log_message.emit("Leaderboard request timed out")
	)


func sync_state() -> void:
	log_message.emit("Syncing board via RPC...")
	var rpc_call = _relay.call_rpc("get_game_state", {})
	if rpc_call == null:
		return
	rpc_call.completed.connect(func(payload: Dictionary):
		_apply_state(payload)
		log_message.emit("Board synced")
		state_changed.emit()
	)
	rpc_call.timed_out.connect(func():
		log_message.emit("Board sync timed out")
	)

# =============================================================================
#  Relay callbacks
# =============================================================================

func _on_connected(client_id: String) -> void:
	_client_id = client_id
	log_message.emit("Client connected (id: %s)" % client_id)
	session_started.emit()
	sync_state()


func _on_disconnected() -> void:
	log_message.emit("Disconnected")
	session_ended.emit()


func _on_broadcast_received(broadcast_name: String, payload: Dictionary) -> void:
	match broadcast_name:
		"dot_collected":
			# Apply only the single dot — don't overwrite optimistic claims
			_apply_dot(payload)
			var claimed_by := str(payload.get("owner", ""))
			var index := int(payload.get("index", -1))
			log_message.emit("Dot %d claimed by %s" % [index, claimed_by])
			state_changed.emit()
		"dot_corrected":
			# Correction replaces a single dot — safe for optimistic state
			_apply_dot(payload)
			var new_owner := str(payload.get("owner", ""))
			var index := int(payload.get("index", -1))
			log_message.emit("Dot %d reassigned to %s (earlier click)" % [index, new_owner])
			state_changed.emit()
		"full_state":
			_apply_state(payload)
			log_message.emit("Received full board state")
			state_changed.emit()
		"game_over":
			_apply_state(payload)
			var winner := str(payload.get("winner", "?"))
			game_ended.emit(winner)
			state_changed.emit()


## Apply a single dot change without replacing the full board.
## Updates the specific dot and the owner's score, preserving optimistic claims.
func _apply_dot(payload: Dictionary) -> void:
	var index := int(payload.get("index", -1))
	var claimed_by := str(payload.get("owner", ""))
	if index >= 0 and index < board.size():
		board[index] = claimed_by
	# Update only this player's score (keep optimistic scores for others)
	if claimed_by != "" and payload.has("score"):
		var host_score := int(payload["score"])
		var local_score := int(scores.get(claimed_by, 0))
		scores[claimed_by] = max(host_score, local_score)
	if payload.has("game_over"):
		game_over = bool(payload["game_over"])
