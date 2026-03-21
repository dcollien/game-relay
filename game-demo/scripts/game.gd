extends Control
## Dot Collector — a multiplayer demo using the Session abstraction.
##
## 100 dots on a 10x10 grid. Players click to claim dots.
## Three modes: Host (network), Client (network), Solo (local AI).
##
## The demo doesn't know which mode it's in — it talks to a Session
## and reacts to its signals. Swap the session class and the game works
## the same way, which is the whole point of the abstraction.

# --- Scene references ---

@onready var relay_url_input: LineEdit = %RelayUrlInput
@onready var game_code_input: LineEdit = %GameCodeInput
@onready var status_label: Label = %StatusLabel
@onready var role_label: Label = %RoleLabel
@onready var counter_label: Label = %CounterLabel
@onready var play_solo_button: Button = %PlaySoloButton
@onready var connect_host_button: Button = %ConnectHostButton
@onready var connect_client_button: Button = %ConnectClientButton
@onready var disconnect_button: Button = %DisconnectButton
@onready var add_ai_check: CheckBox = %AddAICheck
@onready var leaderboard_button: Button = %IncrementButton
@onready var sync_button: Button = %SyncButton
@onready var log_output: RichTextLabel = %LogOutput
@onready var game_content: VBoxContainer = %GameContent

# --- Constants ---

const GRID_SIZE := 10
const TOTAL_DOTS := GRID_SIZE * GRID_SIZE

# --- State ---

var session = null  # Session (any subclass, or null)
var game_grid: GridContainer
var game_over_label: Label
var cells: Array[Button] = []
var marker_by_player: Dictionary = {}
var marker_sequence: int = 0

# =============================================================================
#  Lifecycle
# =============================================================================

func _ready() -> void:
	_build_grid_ui()
	relay_url_input.text = "wss://relay.constult.us/connect"
	game_code_input.text = "ABC123"
	play_solo_button.pressed.connect(_on_play_solo)
	connect_host_button.pressed.connect(_on_connect_host)
	connect_client_button.pressed.connect(_on_connect_client)
	disconnect_button.pressed.connect(_on_disconnect)
	leaderboard_button.pressed.connect(_on_leaderboard)
	sync_button.pressed.connect(_on_sync)
	_refresh_ui()

# =============================================================================
#  Session management
# =============================================================================

## Wire up a new session and start it.
## This is the only place session signals are connected — all three modes
## (host, client, solo) go through the same path.
func _start_session(new_session) -> void:
	_teardown_session()
	session = new_session
	add_child(session)

	session.session_started.connect(_on_session_started)
	session.session_ended.connect(_on_session_ended)
	session.state_changed.connect(_on_state_changed)
	session.game_ended.connect(_on_game_ended)
	session.leaderboard_ready.connect(_show_leaderboard)
	session.log_message.connect(_log)

	session.start_session()
	_refresh_ui()


func _teardown_session() -> void:
	if session:
		session.stop_session()
		session.queue_free()
		session = null
	marker_by_player.clear()
	marker_sequence = 0
	for cell in cells:
		cell.text = "."
		cell.disabled = false

# =============================================================================
#  Connection buttons
# =============================================================================

func _on_play_solo() -> void:
	var s = LocalSession.new()
	_start_session(s)


func _on_connect_host() -> void:
	if relay_url_input.text.is_empty() or game_code_input.text.is_empty():
		_log("Relay URL and game code are required")
		return
	var s = HostSession.new()
	s.relay_url = relay_url_input.text
	s.game_code = game_code_input.text
	s.ai_enabled = add_ai_check.button_pressed
	_start_session(s)


func _on_connect_client() -> void:
	if relay_url_input.text.is_empty() or game_code_input.text.is_empty():
		_log("Relay URL and game code are required")
		return
	var s = ClientSession.new()
	s.relay_url = relay_url_input.text
	s.game_code = game_code_input.text
	_start_session(s)


func _on_disconnect() -> void:
	_teardown_session()
	_log("Disconnected")
	_refresh_ui()

# =============================================================================
#  Session signal handlers
# =============================================================================

func _on_session_started() -> void:
	_refresh_ui()


func _on_session_ended() -> void:
	_refresh_ui()


func _on_state_changed() -> void:
	_update_grid()
	_refresh_ui()


func _on_game_ended(winner_id: String) -> void:
	_log("Game over! Winner: %s" % _display_name(winner_id))
	_refresh_ui()

# =============================================================================
#  Player actions
# =============================================================================

func _on_cell_pressed(index: int) -> void:
	if not session or not session.is_active():
		return
	if session.game_over:
		return
	if session.board[index] != "":
		return
	session.collect_dot(index)


func _on_leaderboard() -> void:
	if not session:
		_log("Start a game first")
		return
	session.request_leaderboard()


func _on_sync() -> void:
	if not session:
		_log("Start a game first")
		return
	session.sync_state()

# =============================================================================
#  Display helpers
# =============================================================================

func _display_name(player_id: String) -> String:
	if player_id == "":
		return "None"
	if session and player_id == session.get_player_id():
		return "You"
	if player_id == "ai":
		return "AI"
	if player_id == "host":
		return "Host"
	return player_id.substr(0, 6) if player_id.length() > 6 else player_id


func _marker_for(player_id: String) -> String:
	if player_id == "":
		return "."
	if session and player_id == session.get_player_id():
		return "Y"
	if player_id == "ai":
		return "A"
	if player_id == "host":
		return "H"
	if not marker_by_player.has(player_id):
		marker_sequence += 1
		marker_by_player[player_id] = str(marker_sequence % 10)
	return str(marker_by_player[player_id])


func _show_leaderboard(entries: Array) -> void:
	_log("=== Leaderboard ===")
	if entries.is_empty():
		_log("  No scores yet")
		return
	for entry in entries:
		if typeof(entry) == TYPE_DICTIONARY:
			_log("  %s: %d" % [_display_name(str(entry.get("owner", "?"))), int(entry.get("score", 0))])

# =============================================================================
#  UI
# =============================================================================

func _build_grid_ui() -> void:
	game_over_label = Label.new()
	game_over_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	game_over_label.text = "Collect all %d dots." % TOTAL_DOTS
	game_content.add_child(game_over_label)

	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	game_content.add_child(center)

	game_grid = GridContainer.new()
	game_grid.columns = GRID_SIZE
	center.add_child(game_grid)

	for i in range(TOTAL_DOTS):
		var cell := Button.new()
		cell.custom_minimum_size = Vector2(36, 36)
		cell.text = "."
		cell.pressed.connect(_on_cell_pressed.bind(i))
		cell.action_mode = BaseButton.ACTION_MODE_BUTTON_PRESS
		game_grid.add_child(cell)
		cells.append(cell)


func _update_grid() -> void:
	if not session:
		return
	for i in range(min(cells.size(), session.board.size())):
		var cell := cells[i]
		cell.text = _marker_for(session.board[i])
		cell.disabled = session.board[i] != "" or session.game_over


func _refresh_ui() -> void:
	var active: bool = session != null and session.is_active()
	var role: String = session.get_role_name() if session else "none"

	match role:
		"host":
			leaderboard_button.text = "Show Leaderboard"
			sync_button.text = "Broadcast State"
		"client":
			leaderboard_button.text = "Show Leaderboard (RPC)"
			sync_button.text = "Sync Board (RPC)"
		"solo":
			leaderboard_button.text = "Show Leaderboard"
			sync_button.text = "Sync Board"
		_:
			leaderboard_button.text = "Show Leaderboard"
			sync_button.text = "Sync Board"

	role_label.text = "Role: %s" % role
	status_label.text = "Status: %s" % ("active" if active else "inactive")

	var dots_left: int = session.remaining() if session else TOTAL_DOTS
	counter_label.text = "Remaining: %d" % dots_left

	if session and session.game_over:
		game_over_label.text = "Game over! Winner: %s" % _display_name(session.leader_id())
	else:
		game_over_label.text = "Collect all %d dots." % TOTAL_DOTS

	play_solo_button.disabled = active
	connect_host_button.disabled = active
	connect_client_button.disabled = active
	disconnect_button.disabled = not active
	_update_grid()


func _log(text: String) -> void:
	log_output.append_text(text + "\n")
