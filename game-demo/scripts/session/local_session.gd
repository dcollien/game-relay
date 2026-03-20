class_name LocalSession
extends Session
## Local solo session — play against an AI opponent with no network.
##
## All game logic runs locally. Uses AiPlayer for the AI opponent,
## the same component HostSession uses when ai_enabled is true.

var _active := false
var _ai: AiPlayer = null

# =============================================================================
#  Interface
# =============================================================================

func start_session() -> void:
	super.start_session()
	_active = true

	_ai = AiPlayer.new()
	_ai.move_requested.connect(func(index: int): _handle_collect("ai", index))
	add_child(_ai)
	_ai.start(board)

	log_message.emit("Solo game started — you vs AI")
	session_started.emit()
	state_changed.emit()


func stop_session() -> void:
	_active = false
	if _ai:
		_ai.stop()
		_ai.queue_free()
		_ai = null
	session_ended.emit()


func is_active() -> bool:
	return _active


func get_player_id() -> String:
	return "player"


func get_role_name() -> String:
	return "solo"


func collect_dot(index: int) -> void:
	_handle_collect("player", index)


func request_leaderboard() -> void:
	leaderboard_ready.emit(_build_leaderboard())


func sync_state() -> void:
	log_message.emit("Local game — state is already current")

# =============================================================================
#  Game logic (same validation as host)
# =============================================================================

func _handle_collect(player_id: String, index: int) -> void:
	if game_over or index < 0 or index >= TOTAL_DOTS:
		return
	if board[index] != "":
		return

	board[index] = player_id
	scores[player_id] = int(scores.get(player_id, 0)) + 1

	if remaining() == 0:
		game_over = true
		if _ai:
			_ai.notify_game_over()
		game_ended.emit(leader_id())

	state_changed.emit()
