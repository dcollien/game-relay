class_name AiPlayer
extends Node
## A simple AI opponent that picks a random unclaimed dot on a timer.
##
## AiPlayer is a reusable Node. Add it as a child, call start(), and
## connect to the [signal move_requested] signal to receive AI moves.
## The AI doesn't modify the board itself — the parent session decides
## what to do with each move, keeping game logic in one place.
##
## Used by both HostSession (networked + AI) and LocalSession (solo).

## Emitted when the AI wants to claim a dot. The parent session should
## validate and apply the move through its normal game logic.
signal move_requested(index: int)

## How often the AI picks a dot, in seconds.
@export var interval := 1.0

## The player ID the AI plays as.
var player_id := "ai"

var _board: Array[String] = []
var _game_over := false
var _timer := 0.0
var _running := false


## Start the AI. Pass the board array — the AI reads it each tick
## to find open dots. The board is passed by reference, so the AI
## always sees the latest state.
func start(board: Array[String]) -> void:
	_board = board
	_game_over = false
	_timer = 0.0
	_running = true


## Stop the AI.
func stop() -> void:
	_running = false


## Call when the game ends so the AI stops moving.
func notify_game_over() -> void:
	_game_over = true
	_running = false


func _process(delta: float) -> void:
	if not _running or _game_over:
		return
	_timer += delta
	if _timer < interval:
		return
	_timer = 0.0

	var open: Array[int] = []
	for i in _board.size():
		if _board[i] == "":
			open.append(i)
	if open.is_empty():
		return
	move_requested.emit(open[randi() % open.size()])
