import type { Payload } from "./client";

export interface HostCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
  onCommand?: (clientId: string, name: string, payload: Payload) => void;
  onBinaryMessage?: (clientId: string, data: ArrayBuffer) => void;
}

export interface HostOptions extends HostCallbacks {
  /** RPC handlers keyed by name. */
  rpcs?: Record<string, (payload: Payload) => Payload>;
  /** Register a built-in clock sync RPC. Default: false. */
  clockSync?: boolean;
}

export interface HostHandle {
  /** Broadcast a named message to all connected clients. */
  broadcast(name: string, payload?: Payload): void;
  /** Broadcast raw binary data to all clients. */
  sendBinary(data: ArrayBuffer | Uint8Array): void;
  /** Close the connection. */
  close(): void;
  /** True if the WebSocket is open. */
  readonly connected: boolean;
}

/**
 * Connect to the relay as the host.
 *
 * ```ts
 * const host = connectAsHost(url, code, {
 *   onConnected() { console.log("hosting!") },
 *   onCommand(clientId, name, data) { console.log(name, data) },
 *   rpcs: {
 *     getScore: () => ({ score: 42 }),
 *   },
 * });
 * host.broadcast("roundStarted", { round: 1 });
 * ```
 */
export function connectAsHost(
  relayUrl: string,
  gameCode: string,
  options: HostOptions = {},
): HostHandle {
  const {
    clockSync = false,
    onConnected,
    onDisconnected,
    onError,
    onCommand,
    onBinaryMessage,
  } = options;

  // Build the RPC handler map from the options object
  const rpcs = new Map<string, (payload: Payload) => Payload>();
  if (options.rpcs) {
    for (const [name, handler] of Object.entries(options.rpcs)) {
      rpcs.set(name, handler);
    }
  }
  if (clockSync) {
    rpcs.set("_clock_sync", (payload) => ({
      client_time: payload.client_time,
      host_time: performance.now() / 1000,
    }));
  }

  const url = `${relayUrl.replace(/\/+$/, "")}/${gameCode}/host`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onclose = () => onDisconnected?.();
  ws.onerror = () => onError?.("WebSocket error");

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      handleBinary(ev.data);
      return;
    }

    let msg: Record<string, unknown>;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    switch (msg.type) {
      case "connected":
        onConnected?.();
        break;
      case "error":
        onError?.((msg.message as string) ?? "unknown error");
        ws.close();
        break;
      case "command":
        onCommand?.(
          (msg.client_id as string) ?? "",
          (msg.name as string) ?? "",
          (msg.payload ?? {}) as Payload,
        );
        break;
      case "rpc_request":
        handleRpc(msg);
        break;
    }
  };

  function handleBinary(data: ArrayBuffer) {
    const view = new Uint8Array(data);
    if (view.length < 1) return;
    const cidLen = view[0];
    if (view.length < 1 + cidLen) return;
    const clientId = new TextDecoder().decode(view.slice(1, 1 + cidLen));
    const payload = data.slice(1 + cidLen);
    onBinaryMessage?.(clientId, payload);
  }

  function handleRpc(msg: Record<string, unknown>) {
    const name = (msg.name as string) ?? "";
    const handler = rpcs.get(name);
    if (!handler) return;

    const response = handler((msg.payload ?? {}) as Payload);
    sendJson({
      type: "rpc_response",
      client_id: msg.client_id,
      message_id: msg.message_id,
      payload: response ?? {},
    });
  }

  function sendJson(data: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  const handle: HostHandle = {
    broadcast(name, payload = {}) {
      sendJson({ type: "broadcast", name, payload });
    },

    sendBinary(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },

    close() {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    },

    get connected() { return ws.readyState === WebSocket.OPEN; },
  };

  return handle;
}
