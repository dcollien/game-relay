# game-relay-client

TypeScript client library for the [game-relay](../relay-server/) WebSocket server. Zero dependencies, browser-native.

## Install

```bash
npm install game-relay-client
```

Or as a local monorepo dependency:

```json
{ "dependencies": { "game-relay-client": "file:../relay-client-ts" } }
```

## Client (joining a game)

```ts
import { connectAsClient } from "game-relay-client";

const client = connectAsClient("wss://your-relay.hf.space/connect", "GAME123", {
  onConnected(id) { console.log("joined as", id); },
  onWaiting(id) { console.log("waiting for host..."); },
  onBroadcast(name, payload) { console.log(name, payload); },
  onBinaryMessage(data) { console.log("binary:", new Uint8Array(data)); },
  onDisconnected() { console.log("disconnected"); },
  onError(msg) { console.error(msg); },
  clockSync: true,
  onClockSynced(offset) { console.log("clock offset:", offset); },
});

// fire-and-forget command
client.send("jump", { height: 5 });

// RPC (returns a promise)
const score = await client.rpc("getScore", { level: 1 });

// RPC with cancellation
const abort = new AbortController();
const result = await client.rpc("slowQuery", {}, abort.signal);

// binary
client.sendBinary(new Uint8Array([1, 2, 3]));

// host-relative time
console.log("host time:", client.hostTime());

// disconnect
client.close();
```

## Host (running a game)

```ts
import { connectAsHost } from "game-relay-client";

const host = connectAsHost("wss://your-relay.hf.space/connect", "GAME123", {
  onConnected() { console.log("hosting!"); },
  onCommand(clientId, name, payload) { console.log(clientId, name, payload); },
  onBinaryMessage(clientId, data) { console.log(clientId, new Uint8Array(data)); },
  onDisconnected() { console.log("disconnected"); },
  onError(msg) { console.error(msg); },
  clockSync: true,
  rpcs: {
    getScore: (payload) => ({ score: 42 }),
    getState: () => ({ hp: 100, mana: 50 }),
  },
});

// broadcast to all clients
host.broadcast("roundStarted", { round: 1 });

// binary broadcast
host.sendBinary(new Float32Array([1.0, 2.0, 3.0]));

// disconnect
host.close();
```

## React example

```tsx
import { useEffect, useRef, useState } from "react";
import { connectAsClient, type ClientHandle } from "game-relay-client";

function useRelay(url: string, gameCode: string) {
  const client = useRef<ClientHandle | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const handle = connectAsClient(url, gameCode, {
      onConnected() { setConnected(true); },
      onDisconnected() { setConnected(false); },
    });
    client.current = handle;
    return () => handle.close();
  }, [url, gameCode]);

  return { client, connected };
}
```

## API

### `connectAsClient(relayUrl, gameCode, options?) → ClientHandle`

| Option | Type | Description |
|---|---|---|
| `onConnected` | `(clientId) => void` | Relay confirmed connection |
| `onWaiting` | `(clientId) => void` | Waiting for host to connect |
| `onDisconnected` | `() => void` | Connection closed |
| `onError` | `(message) => void` | Error occurred |
| `onBroadcast` | `(name, payload) => void` | Received broadcast from host |
| `onBinaryMessage` | `(data) => void` | Received binary frame from host |
| `onClockSynced` | `(offset) => void` | Clock sync completed |
| `rpcTimeoutMs` | `number` | RPC timeout (default: 10000) |
| `clockSync` | `boolean` | Auto-sync clock (default: false) |

| ClientHandle | Description |
|---|---|
| `.send(name, payload?)` | Fire-and-forget command |
| `.rpc(name, payload?, signal?)` | RPC → `Promise<Payload>` |
| `.sendBinary(data)` | Send binary frame |
| `.close()` | Close connection |
| `.clientId` | Assigned client ID |
| `.connected` | WebSocket is open |
| `.hostTime()` | Host-relative time (seconds) |
| `.clockOffset` | Clock offset (seconds) |
| `.isClockSynced` | Clock sync completed |

### `connectAsHost(relayUrl, gameCode, options?) → HostHandle`

| Option | Type | Description |
|---|---|---|
| `onConnected` | `() => void` | Relay confirmed connection |
| `onDisconnected` | `() => void` | Connection closed |
| `onError` | `(message) => void` | Error occurred |
| `onCommand` | `(clientId, name, payload) => void` | Received command from client |
| `onBinaryMessage` | `(clientId, data) => void` | Received binary frame from client |
| `rpcs` | `{ [name]: (payload) => payload }` | RPC handlers |
| `clockSync` | `boolean` | Register clock sync RPC (default: false) |

| HostHandle | Description |
|---|---|
| `.broadcast(name, payload?)` | Broadcast to all clients |
| `.sendBinary(data)` | Binary broadcast |
| `.close()` | Close connection |
| `.connected` | WebSocket is open |
