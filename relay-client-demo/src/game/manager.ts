import { connectAsHost } from "@dcollien/game-relay-client";
import type { Game } from "./game";
import { encodeBroadcast, decodeCommand } from "./binaryCodec";

interface PendingPickup {
  clientId: string;
  circleId: string;
  hostTime: number;
}

export function createManager(
  game: Game,
  relayUrl: string,
  gameCode: string,
  callbacks?: { onDisconnected?: () => void; onError?: (msg: string) => void },
  binary = false,
) {
  const pickupBuffer: PendingPickup[] = [];

  function handleCommand(clientId: string, name: string, x?: number, y?: number, circleId?: string, hostTime?: number, playerName?: string) {
    if (name === "join") {
      game.join(clientId, playerName);
      return;
    }
    game.join(clientId);

    if (name === "move") {
      if (x != null && y != null) game.move(clientId, x, y);
    } else if (name === "drop") {
      const p = game.players.get(clientId);
      game.drop(clientId, x ?? p?.x ?? 0, y ?? p?.y ?? 0);
    } else if (name === "pickup") {
      pickupBuffer.push({
        clientId,
        circleId: circleId!,
        hostTime: hostTime || performance.now() / 1000,
      });
    }
  }

  const host = connectAsHost(relayUrl, gameCode, {
    clockSync: true,
    onConnected() {},

    onDisconnected() {
      callbacks?.onDisconnected?.();
    },

    onCommand: binary ? undefined : (clientId, name, payload) => {
      if (name === "join") {
        handleCommand(clientId, "join", undefined, undefined, undefined, undefined, payload.name ? String(payload.name) : undefined);
      } else if (name === "move") {
        handleCommand(clientId, "move", payload.x != null ? Number(payload.x) : undefined, payload.y != null ? Number(payload.y) : undefined);
      } else if (name === "drop") {
        handleCommand(clientId, "drop", payload.x != null ? Number(payload.x) : undefined, payload.y != null ? Number(payload.y) : undefined);
      } else if (name === "pickup") {
        handleCommand(clientId, "pickup", undefined, undefined, String(payload.circleId), Number(payload.hostTime) || undefined);
      }
    },

    onBinaryMessage: binary ? (clientId: string, data: ArrayBuffer) => {
      const cmd = decodeCommand(data);
      if (!cmd) return;
      if (cmd.type === "join") {
        handleCommand(clientId, "join", undefined, undefined, undefined, undefined, cmd.name);
      } else if (cmd.type === "move") {
        handleCommand(clientId, "move", cmd.x, cmd.y);
      } else if (cmd.type === "drop") {
        handleCommand(clientId, "drop", cmd.x, cmd.y);
      } else if (cmd.type === "pickup") {
        handleCommand(clientId, "pickup", undefined, undefined, cmd.circleId, cmd.hostTime);
      }
    } : undefined,

    onError(msg) {
      console.error("[manager]", msg);
      callbacks?.onError?.(msg);
    },
  });

  return {
    tick() {
      // Resolve pickups — earliest hostTime wins
      const byCircle = new Map<string, PendingPickup[]>();
      for (const p of pickupBuffer) {
        let arr = byCircle.get(p.circleId);
        if (!arr) { arr = []; byCircle.set(p.circleId, arr); }
        arr.push(p);
      }
      pickupBuffer.length = 0;

      for (const [, candidates] of byCircle) {
        candidates.sort((a, b) => a.hostTime - b.hostTime);
        game.pickup(candidates[0].clientId, candidates[0].circleId);
      }

      // Broadcast
      if (binary) {
        host.sendBinary(encodeBroadcast(game.snapshot()));
      } else {
        host.broadcast("state", game.snapshot() as unknown as Record<string, unknown>);
      }
    },

    close() {
      host.close();
    },
  };
}
