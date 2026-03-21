import type { Player, Circle, BroadcastState } from "./state";
import { CANVAS_W, CANVAS_H, PLAYER_RADIUS, DROP_COOLDOWN_S, GAME_DURATION_S, PLAYER_COLORS } from "./state";

export function createGame() {
  const players = new Map<string, Player>();
  const circles: Circle[] = [];
  let nextCircleId = 0;
  let colorIndex = 0;
  const dropTimes = new Map<string, number>();
  const startTime = performance.now() / 1000;

  function timeRemaining() {
    return Math.max(0, GAME_DURATION_S - (performance.now() / 1000 - startTime));
  }

  function isOver() {
    return timeRemaining() <= 0;
  }

  /** Compute score = number of circles this player has on the field. */
  function scoreFor(id: string): number {
    let n = 0;
    for (const c of circles) if (c.droppedBy === id) n++;
    return n;
  }

  return {
    players,
    circles,

    join(id: string, name?: string): Player {
      const existing = players.get(id);
      if (existing) {
        if (name) existing.name = name;
        return existing;
      }
      const p: Player = {
        id,
        name: name || id.slice(0, 6),
        x: CANVAS_W / 2 + (Math.random() - 0.5) * 200,
        y: CANVAS_H / 2 + (Math.random() - 0.5) * 200,
        color: PLAYER_COLORS[colorIndex++ % PLAYER_COLORS.length],
        score: 0,
      };
      players.set(id, p);
      return p;
    },

    leave(id: string) {
      players.delete(id);
      dropTimes.delete(id);
    },

    move(id: string, x: number, y: number) {
      if (isOver()) return;
      const p = players.get(id);
      if (!p) return;
      p.x = clamp(x, PLAYER_RADIUS, CANVAS_W - PLAYER_RADIUS);
      p.y = clamp(y, PLAYER_RADIUS, CANVAS_H - PLAYER_RADIUS);
    },

    drop(id: string, x: number, y: number): Circle | null {
      if (isOver()) return null;
      const p = players.get(id);
      if (!p) return null;
      const now = performance.now() / 1000;
      if (now - (dropTimes.get(id) ?? 0) < DROP_COOLDOWN_S) return null;
      dropTimes.set(id, now);
      const c: Circle = {
        id: `c${nextCircleId++}`,
        x: clamp(x, PLAYER_RADIUS, CANVAS_W - PLAYER_RADIUS),
        y: clamp(y, PLAYER_RADIUS, CANVAS_H - PLAYER_RADIUS),
        color: p.color,
        droppedBy: id,
      };
      circles.push(c);
      return c;
    },

    pickup(id: string, circleId: string): boolean {
      if (isOver()) return false;
      const idx = circles.findIndex(c => c.id === circleId);
      if (idx === -1) return false;
      if (circles[idx].droppedBy === id) return false;
      circles.splice(idx, 1);
      dropTimes.delete(id);
      return true;
    },

    snapshot(): BroadcastState {
      const ps: BroadcastState["players"] = {};
      for (const [id, p] of players) {
        ps[id] = { x: p.x, y: p.y, color: p.color, score: scoreFor(id), name: p.name };
      }
      return {
        players: ps,
        circles: circles.map(c => ({
          id: c.id, x: c.x, y: c.y, color: c.color, droppedBy: c.droppedBy,
        })),
        timeRemaining: timeRemaining(),
        gameOver: isOver(),
      };
    },
  };
}

export type Game = ReturnType<typeof createGame>;

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
