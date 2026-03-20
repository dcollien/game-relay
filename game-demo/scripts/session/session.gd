class_name Session
extends Node
## Abstract base class for a game session.
##
## Session defines the interface between the game UI and whatever
## runs the game — be it a network relay, a local AI, or anything else.
##
## HOW TO USE THIS PATTERN:
##
##   1. The UI (game.gd) holds a var of type Session.
##   2. It calls the interface methods below (start, stop, collect_dot, etc.)
##      without knowing or caring which subclass is running.
##   3. It reacts to the signals below to update the display.
##   4. To add a new mode, create a new subclass and override the interface
##      methods. The UI needs zero changes.
##
## EXISTING SUBCLASSES:
##
##   HostSession    — Networked host. Owns the board, broadcasts state
##                    to clients via relay.
##   ClientSession  — Networked client. Sends commands to the host,
##                    receives broadcasts, supports optimistic updates.
##   LocalSession   — Solo mode. Runs game logic locally with an AI
##                    opponent on a timer. No network required.
##
## WHY THIS WORKS:
##
##   GDScript doesn't have formal interfaces or abstract classes, but we
##   can simulate them with a base class that defines methods with default
##   (no-op) implementations. Subclasses override what they need. The UI
##   only calls methods defined here, so any subclass is a drop-in replacement.
##
##   This is the same idea as an "interface" in Java/C# or a "protocol" in
##   Swift — a contract that says "any session will have these methods and
##   emit these signals."

# =============================================================================
#  SIGNALS — emitted by subclasses, consumed by the UI
# =============================================================================

## The session is ready and the game can begin.
signal session_started()

## The session has ended (disconnected, stopped, etc.).
signal session_ended()

## The board or scores changed — the UI should redraw.
signal state_changed()

## The game is over. [param winner_id] is the player who won.
signal game_ended(winner_id: String)

## A leaderboard was requested and is now ready to display.
## [param entries] is an Array of Dictionaries: [code][{"owner": "id", "score": 5}, ...][/code]
signal leaderboard_ready(entries: Array)

## A message for the debug log.
signal log_message(text: String)

# =============================================================================
#  GAME STATE — read by the UI for rendering, written by subclasses
# =============================================================================

const GRID_SIZE := 10
const TOTAL_DOTS := GRID_SIZE * GRID_SIZE

## The board: board[i] is the player_id who claimed dot i, or "" if unclaimed.
var board: Array[String] = []

## Scores: maps player_id -> number of dots claimed.
var scores: Dictionary = {}

## True when the game has ended (all dots claimed).
var game_over := false

# =============================================================================
#  INTERFACE — override these methods in subclasses
# =============================================================================
#
#  Each method below has a default (no-op) implementation so that
#  subclasses only need to override what they actually use.
#  The doc comments describe the CONTRACT — what the UI expects.
#

## Start the session. Called once after the session node is added to the tree.
## Subclasses should: reset the board, connect to a relay or start AI,
## and emit [signal session_started] when ready.
func start_session() -> void:
	_reset_board()

## Stop the session and clean up. Called when the user disconnects or
## switches modes. Subclasses should: close any network connection,
## stop any timers, and emit [signal session_ended].
func stop_session() -> void:
	pass

## Return true if the session is actively running (connected / playing).
## The UI uses this to enable/disable buttons.
func is_active() -> bool:
	return false

## Return the local player's ID. Examples: "host", a relay client ID,
## or "player" for solo mode. Used by the UI for display ("You" vs others).
func get_player_id() -> String:
	return ""

## Return a human-readable role string: "host", "client", or "solo".
## Used by the UI for labeling.
func get_role_name() -> String:
	return ""

## The human player clicked dot at [param index]. The subclass should
## validate the move, update the board, and emit [signal state_changed].
## For networked clients, this may also send a command to the host.
func collect_dot(_index: int) -> void:
	pass

## Request the current leaderboard. The result arrives asynchronously via
## [signal leaderboard_ready]. For hosts/solo, this is instant. For
## clients, it involves an RPC round-trip.
func request_leaderboard() -> void:
	pass

## Request a full state sync. For hosts, this broadcasts state to all
## clients. For clients, this requests state from the host via RPC.
## For solo, this is a no-op (state is always local).
func sync_state() -> void:
	pass

# =============================================================================
#  SHARED HELPERS — used by all subclasses
# =============================================================================

## Count remaining unclaimed dots.
func remaining() -> int:
	var count := 0
	for cell_value in board:
		if cell_value == "":
			count += 1
	return count


## Return the player_id with the highest score, or "" if no scores.
func leader_id() -> String:
	var best_id := ""
	var best_score := -1
	for pid in scores.keys():
		var s := int(scores[pid])
		if s > best_score:
			best_id = str(pid)
			best_score = s
	return best_id


## Reset the board to its initial state (all dots unclaimed, no scores).
func _reset_board() -> void:
	board.clear()
	board.resize(TOTAL_DOTS)
	board.fill("")
	scores.clear()
	game_over = false


## Build a sorted leaderboard array from current scores.
## Returns: [code][{"owner": "player_id", "score": int}, ...][/code]
func _build_leaderboard() -> Array:
	var entries: Array = []
	for pid in scores.keys():
		entries.append({"owner": str(pid), "score": int(scores[pid])})
	entries.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a.get("score", 0)) > int(b.get("score", 0))
	)
	return entries


## Apply a state payload (from a broadcast or RPC response) to update
## the local board, scores, and game_over flag.
func _apply_state(payload: Dictionary) -> void:
	var incoming_board: Variant = payload.get("board", null)
	if typeof(incoming_board) == TYPE_ARRAY:
		board.clear()
		for item in incoming_board:
			board.append(str(item))

	var incoming_scores: Variant = payload.get("scores", null)
	if typeof(incoming_scores) == TYPE_DICTIONARY:
		scores = incoming_scores.duplicate(true)

	game_over = bool(payload.get("game_over", remaining() == 0))
