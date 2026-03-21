export type Payload = Record<string, unknown>;

export interface ClientCallbacks {
  onConnected?: (clientId: string) => void;
  onWaiting?: (clientId: string) => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
  onBroadcast?: (name: string, payload: Payload) => void;
  onBinaryMessage?: (data: ArrayBuffer) => void;
  onClockSynced?: (offset: number) => void;
}

export interface ClientOptions extends ClientCallbacks {
  /** RPC timeout in milliseconds. Default: 10000. */
  rpcTimeoutMs?: number;
  /** Sync clock with host after connecting. Default: false. */
  clockSync?: boolean;
}

export interface ClientHandle {
  /** Send a one-way command to the host. */
  send(name: string, payload?: Payload): void;
  /** Call an RPC on the host. Rejects on timeout or disconnect. */
  rpc(name: string, payload?: Payload, signal?: AbortSignal): Promise<Payload>;
  /** Send raw binary data to the host. */
  sendBinary(data: ArrayBuffer | Uint8Array): void;
  /** Close the connection. */
  close(): void;
  /** The client ID assigned by the relay. */
  readonly clientId: string;
  /** True if the WebSocket is open. */
  readonly connected: boolean;
  /** Current time in host-relative seconds (after clock sync). */
  hostTime(): number;
  /** Clock offset in seconds (add to local time for host time). */
  readonly clockOffset: number;
  /** Whether clock sync has completed. */
  readonly isClockSynced: boolean;
}

/**
 * Connect to the relay as a client.
 *
 * ```ts
 * const client = connectAsClient(url, code, {
 *   onConnected(id) { console.log("joined as", id) },
 *   onBroadcast(name, data) { console.log(name, data) },
 * });
 * client.send("jump", { height: 5 });
 * const score = await client.rpc("getScore");
 * ```
 */
export function connectAsClient(
  relayUrl: string,
  gameCode: string,
  options: ClientOptions = {},
): ClientHandle {
  const {
    rpcTimeoutMs = 10_000,
    clockSync = false,
    onConnected,
    onWaiting,
    onDisconnected,
    onError,
    onBroadcast,
    onBinaryMessage,
    onClockSynced,
  } = options;

  let clientId = "";
  let clockOffset = 0;
  let clockSynced = false;
  let seq = 0;

  // Pending RPCs: messageId → { resolve, reject, timer }
  const pending = new Map<
    string,
    { resolve: (p: Payload) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const url = `${relayUrl.replace(/\/+$/, "")}/${gameCode}/client`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onclose = () => {
    rejectAll("disconnected");
    clientId = "";
    clockSynced = false;
    onDisconnected?.();
  };

  ws.onerror = () => onError?.("WebSocket error");

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      onBinaryMessage?.(ev.data);
      return;
    }

    let msg: Record<string, unknown>;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    switch (msg.type) {
      case "connected":
        clientId = (msg.client_id as string) ?? "";
        onConnected?.(clientId);
        if (clockSync) syncClock();
        break;
      case "waiting":
        clientId = (msg.client_id as string) ?? "";
        onWaiting?.(clientId);
        break;
      case "error":
        onError?.((msg.message as string) ?? "unknown error");
        ws.close();
        break;
      case "rpc_response": {
        const id = (msg.message_id as string) ?? "";
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
          entry.resolve((msg.payload ?? {}) as Payload);
        }
        break;
      }
      case "broadcast":
        onBroadcast?.(
          (msg.name as string) ?? "",
          (msg.payload ?? {}) as Payload,
        );
        break;
    }
  };

  function rejectAll(reason: string) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  function sendJson(data: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  function syncClock() {
    const sendTime = performance.now() / 1000;
    handle
      .rpc("_clock_sync", { client_time: sendTime })
      .then((payload) => {
        const receiveTime = performance.now() / 1000;
        const rtt = receiveTime - sendTime;
        const hostT = (payload.host_time as number) ?? 0;
        clockOffset = hostT - (sendTime + rtt / 2);
        clockSynced = true;
        onClockSynced?.(clockOffset);
      })
      .catch(() => { clockSynced = false; });
  }

  const handle: ClientHandle = {
    send(name, payload = {}) {
      sendJson({ type: "command", name, payload });
    },

    rpc(name, payload = {}, signal?) {
      const messageId = `${Date.now()}-${++seq}`;

      return new Promise<Payload>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error(`RPC "${name}" aborted`));
          return;
        }

        const timer = setTimeout(() => {
          pending.delete(messageId);
          reject(new Error(`RPC "${name}" timed out`));
        }, rpcTimeoutMs);

        const onAbort = () => {
          clearTimeout(timer);
          pending.delete(messageId);
          reject(new Error(`RPC "${name}" aborted`));
        };

        signal?.addEventListener("abort", onAbort, { once: true });

        pending.set(messageId, {
          resolve: (p) => {
            signal?.removeEventListener("abort", onAbort);
            resolve(p);
          },
          reject,
          timer,
        });

        sendJson({ type: "rpc_request", message_id: messageId, name, payload });
      });
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
      rejectAll("closed");
      clientId = "";
      clockSynced = false;
    },

    get clientId() { return clientId; },
    get connected() { return ws.readyState === WebSocket.OPEN; },
    hostTime() { return performance.now() / 1000 + clockOffset; },
    get clockOffset() { return clockOffset; },
    get isClockSynced() { return clockSynced; },
  };

  return handle;
}
