import type { Player, Circle, BroadcastState } from "./state";
import { CANVAS_W, CANVAS_H, PLAYER_RADIUS, PLAYER_SPEED, PICKUP_DISTANCE, DROP_COOLDOWN_S } from "./state";
import { clamp } from "./game";

// ── Types ──

export interface DisplayPlayer extends Player {
  targetX: number;
  targetY: number;
}

export interface PlayerView {
  myId: string;
  players: Map<string, DisplayPlayer>;
  circles: Circle[];
  cooldown: number; // 0 = ready, 1 = just dropped
  timeRemaining: number;
  gameOver: boolean;
  connected: boolean;
  waiting: boolean;
  clockSynced: boolean;
}

export interface InputSettings {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  drop: string[];
}

export const DEFAULT_INPUT: InputSettings = {
  left: ["ArrowLeft", "a"],
  right: ["ArrowRight", "d"],
  up: ["ArrowUp", "w"],
  down: ["ArrowDown", "s"],
  drop: [" "],
};

export interface PlayerHandle {
  readonly view: PlayerView;
  settings: InputSettings;
  applySnapshot(snapshot: BroadcastState): void;
  attach(): void;
  detach(): void;
  close(): void;
}

// ── Single player implementation ──

const LERP_SPEED = 12;

export function createPlayer(opts: {
  send: (name: string, payload: Record<string, unknown>) => void;
  hostTime?: () => number | undefined;
  settings?: Partial<InputSettings>;
}): PlayerHandle {
  let inputSettings: InputSettings = { ...DEFAULT_INPUT, ...opts.settings };

  const view: PlayerView = {
    myId: "",
    players: new Map(),
    circles: [],
    cooldown: 0,
    timeRemaining: 0,
    gameOver: false,
    connected: false,
    waiting: false,
    clockSynced: false,
  };

  const keysDown = new Set<string>();
  const optimisticPickups = new Set<string>();
  const optimisticDrops: Circle[] = [];
  let lastFrame = performance.now() / 1000;
  let lastDropTime = 0;
  let animFrame = 0;

  // ── Game loop ──

  function loop() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - lastFrame, 0.1);
    lastFrame = now;

    const me = view.players.get(view.myId);

    // Update cooldown
    const elapsed = now - lastDropTime;
    view.cooldown = lastDropTime === 0 ? 0 : Math.max(0, 1 - elapsed / DROP_COOLDOWN_S);

    // Freeze input when game is over
    if (view.gameOver) {
      animFrame = requestAnimationFrame(loop);
      return;
    }

    // Input → movement prediction
    let dx = 0, dy = 0;
    if (inputSettings.left.some(k => keysDown.has(k))) dx -= 1;
    if (inputSettings.right.some(k => keysDown.has(k))) dx += 1;
    if (inputSettings.up.some(k => keysDown.has(k))) dy -= 1;
    if (inputSettings.down.some(k => keysDown.has(k))) dy += 1;
    if (dx !== 0 && dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
    }

    if ((dx !== 0 || dy !== 0) && me) {
      me.x = clamp(me.x + dx * PLAYER_SPEED * dt, PLAYER_RADIUS, CANVAS_W - PLAYER_RADIUS);
      me.y = clamp(me.y + dy * PLAYER_SPEED * dt, PLAYER_RADIUS, CANVAS_H - PLAYER_RADIUS);
      me.targetX = me.x;
      me.targetY = me.y;
      opts.send("move", { dx, dy, dt, x: me.x, y: me.y });
    }

    // Lerp remote players
    for (const p of view.players.values()) {
      if (p.id === view.myId) continue;
      const f = 1 - Math.exp(-LERP_SPEED * dt);
      p.x += (p.targetX - p.x) * f;
      p.y += (p.targetY - p.y) * f;
    }

    // Pickups — optimistic local removal, then notify authority
    if (me) {
      for (let i = view.circles.length - 1; i >= 0; i--) {
        const c = view.circles[i];
        if (c.droppedBy === view.myId || optimisticPickups.has(c.id)) continue;
        const cdx = me.x - c.x, cdy = me.y - c.y;
        if (Math.sqrt(cdx * cdx + cdy * cdy) <= PICKUP_DISTANCE + PLAYER_RADIUS) {
          view.circles.splice(i, 1);
          optimisticPickups.add(c.id);
          lastDropTime = 0;
          opts.send("pickup", {
            circleId: c.id,
            hostTime: opts.hostTime?.(),
          });
        }
      }
    }

    animFrame = requestAnimationFrame(loop);
  }

  // ── Input handlers ──

  function onKeyDown(e: KeyboardEvent) {
    keysDown.add(e.key);
    if (inputSettings.drop.includes(e.key)) {
      e.preventDefault();
      const now = performance.now() / 1000;
      if (now - lastDropTime >= DROP_COOLDOWN_S) {
        lastDropTime = now;
        const me = view.players.get(view.myId);
        if (me) {
          const optCircle = {
            id: `opt_${now}`,
            x: me.x, y: me.y,
            color: me.color,
            droppedBy: view.myId,
          };
          optimisticDrops.push(optCircle);
          view.circles.push(optCircle);
          opts.send("drop", { x: me.x, y: me.y });
        }
      }
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keysDown.delete(e.key);
  }

  // ── Apply state snapshot from authority ──

  function applySnapshot(bs: BroadcastState) {
    view.timeRemaining = bs.timeRemaining;
    view.gameOver = bs.gameOver;

    // Snapshot is truth. Keep optimistic drops that haven't appeared
    // in the snapshot yet (matching by position since IDs differ).
    const snapshotCircles = bs.circles.filter(c => !optimisticPickups.has(c.id));

    // Remove optimistic drops that now have a confirmed counterpart
    const confirmed = new Set(bs.circles.map(c => `${c.droppedBy}:${c.x}:${c.y}`));
    for (let i = optimisticDrops.length - 1; i >= 0; i--) {
      const d = optimisticDrops[i];
      if (confirmed.has(`${d.droppedBy}:${d.x}:${d.y}`)) {
        optimisticDrops.splice(i, 1);
      }
    }

    view.circles = [...optimisticDrops, ...snapshotCircles];

    for (const id of optimisticPickups) {
      if (!bs.circles.some(c => c.id === id)) optimisticPickups.delete(id);
    }

    // Players: own position is authoritative, lerp targets for remotes
    const seen = new Set<string>();
    for (const [id, p] of Object.entries(bs.players)) {
      seen.add(id);
      const existing = view.players.get(id);
      if (existing) {
        if (id === view.myId) {
          existing.color = p.color;
          existing.score = p.score;
          existing.name = p.name;
        } else {
          existing.targetX = p.x;
          existing.targetY = p.y;
          existing.color = p.color;
          existing.score = p.score;
          existing.name = p.name;
        }
      } else {
        view.players.set(id, {
          id, name: p.name, x: p.x, y: p.y, targetX: p.x, targetY: p.y,
          color: p.color, score: p.score,
        });
      }
    }
    for (const id of view.players.keys()) {
      if (!seen.has(id)) view.players.delete(id);
    }
  }

  function detach() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    cancelAnimationFrame(animFrame);
  }

  return {
    view,
    get settings() { return inputSettings; },
    set settings(s) { inputSettings = s; },
    applySnapshot,
    attach() {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      animFrame = requestAnimationFrame(loop);
    },
    detach,
    close() { detach(); },
  };
}
