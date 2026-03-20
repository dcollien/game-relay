class_name RelayHost
extends Node
## Host-side relay connection.
##
## Receives commands from clients, serves RPC requests, and broadcasts
## state to all connected clients.
##
## Usage:
##   var relay = RelayHost.new()
##   add_child(relay)
##   relay.connected.connect(_on_connected)
##   relay.command_received.connect(_on_command)
##   relay.register_rpc("get_state", func(payload): return {"hp": 100})
##   relay.connect_to_relay(url, game_code)
##
## Clock Sync:
##   Set clock_sync_enabled = true before connecting. The host will
##   automatically register a "_clock_sync" RPC that clients use to
##   calculate their clock offset. Commands from synced clients will
##   include a "_host_time" field in their payload.

# --- Signals ---

signal connected()
signal disconnected()
signal error(message: String)
signal debug(message: String)
signal command_received(client_id: String, command_name: String, payload: Dictionary)

# --- Configuration ---

## Enable clock synchronization. When true, a built-in "_clock_sync" RPC
## is registered automatically so clients can calculate their clock offset.
@export var clock_sync_enabled := false

# --- State ---

var _socket := WebSocketPeer.new()
var _rpc_handlers: Dictionary = {}
var _is_active := false

# --- Public API ---

func connect_to_relay(relay_url: String, game_code: String) -> bool:
	if relay_url.is_empty() or game_code.is_empty():
		error.emit("Relay URL and game code are required")
		return false
	if _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_socket.close()
	_socket = WebSocketPeer.new()
	_is_active = true
	if clock_sync_enabled:
		_register_clock_sync_rpc()
	var url := "%s/%s/host" % [relay_url.trim_suffix("/"), game_code]
	debug.emit("Connecting to %s" % url)
	var result := _socket.connect_to_url(url)
	if result != OK:
		_is_active = false
		error.emit("Failed to connect: %s" % error_string(result))
		return false
	return true


func close_connection() -> void:
	if _socket.get_ready_state() in [WebSocketPeer.STATE_OPEN, WebSocketPeer.STATE_CONNECTING]:
		_socket.close()
	_is_active = false
	disconnected.emit()


func is_relay_connected() -> bool:
	return _socket.get_ready_state() == WebSocketPeer.STATE_OPEN


func register_rpc(rpc_name: String, handler: Callable) -> void:
	_rpc_handlers[rpc_name] = handler


func broadcast(broadcast_name: String, data: Dictionary = {}) -> bool:
	if not is_relay_connected():
		error.emit("Not connected")
		return false
	debug.emit("-> broadcast '%s'" % broadcast_name)
	return _send_json({"type": "broadcast", "name": broadcast_name, "payload": data})

# --- Internal: Socket polling ---

func _process(_delta: float) -> void:
	_poll_socket()


func _poll_socket() -> void:
	var state := _socket.get_ready_state()
	match state:
		WebSocketPeer.STATE_CONNECTING, WebSocketPeer.STATE_OPEN:
			_socket.poll()
			while _socket.get_available_packet_count() > 0:
				_handle_raw_message(_socket.get_packet().get_string_from_utf8())
		WebSocketPeer.STATE_CLOSING:
			_socket.poll()
		WebSocketPeer.STATE_CLOSED:
			if _is_active:
				_is_active = false
				disconnected.emit()

# --- Internal: Message routing ---

func _handle_raw_message(text: String) -> void:
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		error.emit("Invalid JSON from relay")
		return
	var msg: Dictionary = parsed
	_route_message(str(msg.get("type", "")), msg)


func _route_message(type: String, msg: Dictionary) -> void:
	match type:
		"connected":
			debug.emit("Session started")
			connected.emit()
		"error":
			var relay_msg := str(msg.get("message", "unknown"))
			debug.emit("Relay error: %s" % relay_msg)
			error.emit(relay_msg)
			close_connection()
		"command":
			_handle_command(msg)
		"rpc_request":
			_handle_rpc_request(msg)
		_:
			debug.emit("Unhandled message type: %s" % type)


func _handle_command(msg: Dictionary) -> void:
	var client_id := str(msg.get("client_id", ""))
	var cmd_name := str(msg.get("name", ""))
	var payload := _extract_payload(msg)
	debug.emit("<- command '%s' from %s" % [cmd_name, client_id])
	command_received.emit(client_id, cmd_name, payload)


func _handle_rpc_request(msg: Dictionary) -> void:
	var client_id := str(msg.get("client_id", ""))
	var message_id := str(msg.get("message_id", ""))
	var rpc_name := str(msg.get("name", ""))
	var payload := _extract_payload(msg)

	if not _rpc_handlers.has(rpc_name):
		error.emit("No RPC handler for '%s'" % rpc_name)
		return
	var handler: Callable = _rpc_handlers[rpc_name]
	if not handler.is_valid():
		error.emit("RPC handler invalid for '%s'" % rpc_name)
		return

	var response: Variant = handler.call(payload)
	if typeof(response) != TYPE_DICTIONARY:
		response = {}

	debug.emit("<- rpc '%s' from %s -> response" % [rpc_name, client_id])
	_send_json({
		"type": "rpc_response",
		"client_id": client_id,
		"message_id": message_id,
		"payload": response,
	})

# --- Internal: Helpers ---

func _extract_payload(msg: Dictionary) -> Dictionary:
	var raw: Variant = msg.get("payload", {})
	return raw if typeof(raw) == TYPE_DICTIONARY else {}


func _send_json(data: Dictionary) -> bool:
	if not is_relay_connected():
		error.emit("Not connected")
		return false
	var result := _socket.send_text(JSON.stringify(data))
	if result != OK:
		error.emit("Send failed: %s" % error_string(result))
		return false
	return true


# --- Internal: Clock sync ---

func _register_clock_sync_rpc() -> void:
	register_rpc("_clock_sync", func(payload: Dictionary) -> Dictionary:
		return {
			"client_time": payload.get("client_time", 0.0),
			"host_time": Time.get_ticks_msec() / 1000.0,
		}
	)
	debug.emit("Clock sync RPC registered")
