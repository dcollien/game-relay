import { useEffect, useRef, useState } from "react";
import { connectAsClient } from "@dcollien/game-relay-client";
import type { Payload } from "@dcollien/game-relay-client";
import type { Role } from "../App";
import type { BroadcastState } from "../game/state";
import { createGame } from "../game/game";
import { createManager } from "../game/manager";
import { createPlayer, type PlayerHandle } from "../game/player";
import { BROADCAST_INTERVAL_MS } from "../game/state";
import { encodeCommand, decodeBroadcast } from "../game/binaryCodec";

export function useGameSession(role: Role, relayUrl: string, gameCode: string, playerName: string, binary = false) {
  const playerRef = useRef<PlayerHandle | null>(null);
  const [status, setStatus] = useState(
    role === "host" ? "Connecting as host…" : "Connecting…",
  );  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let player: PlayerHandle;
    let mgr: ReturnType<typeof createManager> | null = null;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let closeTransport: (() => void) | null = null;

    if (role === "host") {
      const game = createGame();
      const id = "host";
      game.join(id, playerName);

      player = createPlayer({
        send(name, payload) {
          if (name === "move") game.move(id, Number(payload.x), Number(payload.y));
          else if (name === "drop") game.drop(id, Number(payload.x), Number(payload.y));
          else if (name === "pickup") game.pickup(id, String(payload.circleId));
        },
      });
      player.view.myId = id;
      player.view.connected = true;
      player.view.clockSynced = true;

      mgr = createManager(game, relayUrl, gameCode, {
        onDisconnected() { setStatus("Host disconnected"); },
        onError(msg) { setError(msg); },
      }, binary);

      tickTimer = setInterval(() => {
        player.applySnapshot(game.snapshot());
        mgr!.tick();
      }, BROADCAST_INTERVAL_MS);

      setStatus("");
    } else {
      let client: ReturnType<typeof connectAsClient>;

      if (binary) {
        player = createPlayer({
          send(name, payload) {
            if (name === "move") {
              client.sendBinary(encodeCommand({ type: "move", x: Number(payload.x), y: Number(payload.y) }));
            } else if (name === "drop") {
              client.sendBinary(encodeCommand({ type: "drop", x: Number(payload.x), y: Number(payload.y) }));
            } else if (name === "pickup") {
              client.sendBinary(encodeCommand({
                type: "pickup",
                circleId: String(payload.circleId),
                hostTime: Number(payload.hostTime) || 0,
              }));
            }
          },
          hostTime() { return client.isClockSynced ? client.hostTime() : undefined; },
        });
      } else {
        player = createPlayer({
          send(name, payload) { client.send(name, payload); },
          hostTime() { return client.isClockSynced ? client.hostTime() : undefined; },
        });
      }

      client = connectAsClient(relayUrl, gameCode, {
        clockSync: true,
        onWaiting(id) {
          player.view.myId = id;
          player.view.waiting = true;
          setStatus("Waiting for host…");
        },
        onConnected(id) {
          player.view.myId = id;
          player.view.connected = true;
          player.view.waiting = false;
          if (binary) {
            client.sendBinary(encodeCommand({ type: "join", name: playerName }));
          } else {
            client.send("join", { name: playerName });
          }
          setStatus("");
        },
        onClockSynced() { player.view.clockSynced = true; },
        onBroadcast: binary ? undefined : (_name: string, payload: Payload) => {
          player.applySnapshot(payload as unknown as BroadcastState);
        },
        onBinaryMessage: binary ? (data: ArrayBuffer) => {
          player.applySnapshot(decodeBroadcast(data));
        } : undefined,
        onDisconnected() {
          player.view.connected = false;
          player.detach();
          setStatus("Disconnected");
        },
        onError(msg) { console.error("[client]", msg); setError(msg); },
      });

      closeTransport = () => client.close();
    }

    playerRef.current = player;
    player.attach();

    return () => {
      if (tickTimer) clearInterval(tickTimer);
      player.close();
      mgr?.close();
      closeTransport?.();
      playerRef.current = null;
    };
  }, [role, relayUrl, gameCode, playerName, binary]);

  return { player: playerRef, status, error };
}
