/** Colours assignable to players. */
export const PLAYER_COLORS = [
  "#e74c3c", // red
  "#3498db", // blue
  "#2ecc71", // green
  "#f1c40f", // yellow
  "#9b59b6", // purple
  "#e67e22", // orange
  "#1abc9c", // teal
  "#e84393", // pink
] as const;

export const CANVAS_W = 800;
export const CANVAS_H = 600;
export const PLAYER_RADIUS = 18;
export const CIRCLE_RADIUS = 8;
export const PICKUP_DISTANCE = 24;
export const PLAYER_SPEED = 200; // px/s
export const BROADCAST_INTERVAL_MS = 50; // 20 Hz
export const DROP_COOLDOWN_S = 1.6;
export const GAME_DURATION_S = 30;

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  score: number;
}

export interface Circle {
  id: string;
  x: number;
  y: number;
  color: string;
  droppedBy: string;
}

export interface GameState {
  players: Record<string, Player>;
  circles: Circle[];
}

/** Wire format sent in broadcast. */
export interface BroadcastState {
  players: Record<string, { x: number; y: number; color: string; score: number; name: string }>;
  circles: { id: string; x: number; y: number; color: string; droppedBy: string }[];
  timeRemaining: number;
  gameOver: boolean;
}
