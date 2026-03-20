class_name RelayClient
extends Node
## Client-side relay connection.
##
## Sends commands to the host (fire-and-forget), makes RPC calls that
## return trackable RPCCall objects, and receives broadcasts.
##
## Usage:
##   var relay = RelayClient.new()
##   add_child(relay)
##   relay.connected.connect(func(id): print("My id: ", id))
##   relay.broadcast_received.connect(_on_broadcast)
##   relay.connect_to_relay(url, game_code)
##
##   # Send a command (fire-and-forget):
##   relay.send("jump", {"height": 5})
##
##   # Call an RPC (returns trackable object):
##   var call = relay.call_rpc("get_score", {})
##   call.completed.connect(func(payload): print(payload))
##   call.timed_out.connect(func(): print("timed out"))
##
## Clock Sync:
##   Set clock_sync_enabled = true before connecting. After connecting,
##   the client automatically syncs its clock with the host. Use
##   host_time() to get the current time in host-relative seconds, or
##   get_clock_offset() to get the raw offset.

# --- Inner class for tracking RPC calls ---

class RPCCall:
	signal completed(payload: Dictionary)
	signal timed_out()
	var _name: String
	var _message_id: String
	var _expires_at: int

# --- Signals ---

signal connected(client_id: String)
signal disconnected()
signal error(message: String)
signal debug(message: String)
signal broadcast_received(broadcast_name: String, payload: Dictionary)
signal clock_synced(offset: float)

# --- Configuration ---

@export_range(0.1, 120.0, 0.1) var rpc_timeout_seconds: float = 10.0

## Enable clock synchronization. When true, the client automatically
## syncs its clock with the host after connecting. The offset is
## available via get_clock_offset() and host_time().
@export var clock_sync_enabled := false

# --- State ---

var _socket := WebSocketPeer.new()
var _client_id := ""
var _is_active := false
var _message_sequence: int = 0
var _pending_rpcs: Dictionary = {}
var _clock_offset := 0.0
var _clock_synced := false

# --- Public API ---

func connect_to_relay(relay_url: String, game_code: String) -> bool:
	if relay_url.is_empty() or game_code.is_empty():
		error.emit("Relay URL and game code are required")
		return false
	if _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_socket.close()
	_socket = WebSocketPeer.new()
	_client_id = ""
	_is_active = true
	var url := "%s/%s/client" % [relay_url.trim_suffix("/"), game_code]
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
	_cancel_all_rpcs()
	_is_active = false
	_client_id = ""
	_clock_synced = false
	disconnected.emit()


func is_relay_connected() -> bool:
	return _socket.get_ready_state() == WebSocketPeer.STATE_OPEN


func get_client_id() -> String:
	return _client_id


## Return the clock offset in seconds (add to local time to get host time).
## Only meaningful after clock_synced signal has fired.
func get_clock_offset() -> float:
	return _clock_offset


## Return the current time in host-relative seconds.
## Before clock sync completes, this returns local time (offset is 0).
func host_time() -> float:
	return Time.get_ticks_msec() / 1000.0 + _clock_offset


## True if clock sync has completed successfully.
func is_clock_synced() -> bool:
	return _clock_synced


func send(command_name: String, data: Dictionary = {}) -> bool:
	if not is_relay_connected():
		error.emit("Not connected")
		return false
	debug.emit("-> command '%s'" % command_name)
	return _send_json({"type": "command", "name": command_name, "payload": data})


func call_rpc(rpc_name: String, payload: Dictionary = {}, timeout: float = -1.0) -> RPCCall:
	if not is_relay_connected():
		error.emit("Not connected")
		return null
	_message_sequence += 1
	var message_id := "%d-%d" % [Time.get_ticks_msec(), _message_sequence]

	var rpc_call := RPCCall.new()
	rpc_call._name = rpc_name
	rpc_call._message_id = message_id
	var effective_timeout := timeout if timeout > 0.0 else rpc_timeout_seconds
	rpc_call._expires_at = Time.get_ticks_msec() + int(effective_timeout * 1000.0)

	if not _send_json({
		"type": "rpc_request",
		"message_id": message_id,
		"name": rpc_name,
		"payload": payload,
	}):
		rpc_call.timed_out.emit()
		return rpc_call

	debug.emit("-> rpc '%s'" % rpc_name)
	_pending_rpcs[message_id] = rpc_call
	return rpc_call

# --- Internal: Socket polling ---

func _process(_delta: float) -> void:
	_poll_socket()
	_check_rpc_timeouts()


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
				_cancel_all_rpcs()
				_is_active = false
				_client_id = ""
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
			_client_id = str(msg.get("client_id", ""))
			debug.emit("Connected as %s" % _client_id)
			connected.emit(_client_id)
			if clock_sync_enabled:
				_perform_clock_sync()
		"waiting":
			var hinted_id := str(msg.get("client_id", ""))
			if hinted_id != "":
				_client_id = hinted_id
			debug.emit("Waiting for host...")
		"error":
			var relay_msg := str(msg.get("message", "unknown"))
			debug.emit("Relay error: %s" % relay_msg)
			error.emit(relay_msg)
			close_connection()
		"rpc_response":
			_handle_rpc_response(msg)
		"broadcast":
			_handle_broadcast(msg)
		_:
			debug.emit("Unhandled message type: %s" % type)


func _handle_rpc_response(msg: Dictionary) -> void:
	var message_id := str(msg.get("message_id", ""))
	if not _pending_rpcs.has(message_id):
		return
	var rpc_call: RPCCall = _pending_rpcs[message_id]
	_pending_rpcs.erase(message_id)
	debug.emit("<- rpc response '%s'" % rpc_call._name)
	rpc_call.completed.emit(_extract_payload(msg))


func _handle_broadcast(msg: Dictionary) -> void:
	var broadcast_name := str(msg.get("name", ""))
	debug.emit("<- broadcast '%s'" % broadcast_name)
	broadcast_received.emit(broadcast_name, _extract_payload(msg))

# --- Internal: RPC timeout management ---

func _check_rpc_timeouts() -> void:
	if _pending_rpcs.is_empty():
		return
	var now := Time.get_ticks_msec()
	var expired: Array[String] = []
	for id in _pending_rpcs.keys():
		var rpc_call: RPCCall = _pending_rpcs[id]
		if now >= rpc_call._expires_at:
			expired.append(id)
	for id in expired:
		var rpc_call: RPCCall = _pending_rpcs[id]
		_pending_rpcs.erase(id)
		debug.emit("RPC '%s' timed out" % rpc_call._name)
		rpc_call.timed_out.emit()


func _cancel_all_rpcs() -> void:
	for id in _pending_rpcs.keys():
		var rpc_call: RPCCall = _pending_rpcs[id]
		rpc_call.timed_out.emit()
	_pending_rpcs.clear()

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

func _perform_clock_sync() -> void:
	var send_time := Time.get_ticks_msec() / 1000.0
	var rpc_call := call_rpc("_clock_sync", {"client_time": send_time})
	if rpc_call == null:
		return
	rpc_call.completed.connect(func(payload: Dictionary):
		var receive_time := Time.get_ticks_msec() / 1000.0
		var round_trip := receive_time - send_time
		var one_way := round_trip / 2.0
		var host_t := float(payload.get("host_time", 0.0))
		_clock_offset = host_t - (send_time + one_way)
		_clock_synced = true
		debug.emit("Clock synced: offset=%.3fs, rtt=%.3fs" % [_clock_offset, round_trip])
		clock_synced.emit(_clock_offset)
	)
	rpc_call.timed_out.connect(func():
		debug.emit("Clock sync timed out — using zero offset")
		_clock_synced = false
	)
