import type { PlayerView } from "./player";
import {
  CANVAS_W,
  CANVAS_H,
  PLAYER_RADIUS,
  CIRCLE_RADIUS,
  GAME_DURATION_S,
} from "./state";

export function drawGame(ctx: CanvasRenderingContext2D, view: PlayerView) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < CANVAS_W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
  }
  for (let y = 0; y < CANVAS_H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
  }

  // Dropped circles
  for (const c of view.circles) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Players
  for (const p of view.players.values()) {
    const isMe = p.id === view.myId;

    // Shadow / glow for local player
    if (isMe) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = isMe ? "#fff" : "rgba(255,255,255,0.5)";
    ctx.lineWidth = isMe ? 2.5 : 1.5;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Cooldown ring (local player only)
    if (isMe && view.cooldown > 0) {
      const r = PLAYER_RADIUS + 4;
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + Math.PI * 2 * view.cooldown;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, startAngle, endAngle);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Score label
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.score), p.x, p.y);
  }

  // Timer bar
  const frac = Math.max(0, view.timeRemaining / GAME_DURATION_S);
  const barW = CANVAS_W - 24;
  const barH = 6;
  const barX = 12;
  const barY = CANVAS_H - 14;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.roundRect(barX, barY, barW, barH, 3);
  ctx.fill();
  const urgency = frac < 0.2 ? "#e74c3c" : frac < 0.5 ? "#f1c40f" : "#2ecc71";
  ctx.fillStyle = urgency;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * frac, barH, 3);
  ctx.fill();

  // Timer text
  const secs = Math.ceil(view.timeRemaining);
  ctx.fillStyle = secs <= 5 ? "#e74c3c" : "#ccc";
  ctx.font = "bold 14px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${secs}s`, CANVAS_W / 2, barY - 4);

  // Game over overlay
  if (view.gameOver) {
    drawGameOver(ctx, view);
  }
}

export function drawScoreboard(ctx: CanvasRenderingContext2D, view: PlayerView) {
  const players = [...view.players.values()].sort((a, b) => b.score - a.score);
  if (players.length === 0) return;

  const lineH = 24;
  const padX = 16;
  const padY = 12;
  const w = 200;
  const h = padY * 2 + lineH * (players.length + 1);
  const x = CANVAS_W - w - 12;
  const y = 12;

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();

  ctx.fillStyle = "#ccc";
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Scoreboard", x + padX, y + padY);

  ctx.font = "12px system-ui";
  players.forEach((p, i) => {
    const py = y + padY + lineH * (i + 1);
    // Color dot
    ctx.beginPath();
    ctx.arc(x + padX + 5, py + 6, 5, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    const label = p.id === view.myId ? `You` : p.name;
    ctx.fillStyle = "#eee";
    ctx.fillText(`${label}: ${p.score}`, x + padX + 16, py);
  });
}

function drawGameOver(ctx: CanvasRenderingContext2D, view: PlayerView) {
  // Dim overlay
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const players = [...view.players.values()].sort((a, b) => b.score - a.score);
  const winner = players[0];
  if (!winner) return;

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  // "Game Over" heading
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Game Over", cx, cy - 60);

  // Winner announcement
  const isTie = players.length > 1 && players[0].score === players[1].score;
  if (isTie) {
    ctx.fillStyle = "#ccc";
    ctx.font = "bold 24px system-ui";
    ctx.fillText("It's a tie!", cx, cy - 15);
  } else {
    const isMe = winner.id === view.myId;
    const name = isMe ? "You" : winner.name;
    ctx.fillStyle = winner.color;
    ctx.font = "bold 24px system-ui";
    ctx.fillText(`${name} ${isMe ? "win" : "wins"}!`, cx, cy - 15);
  }

  // Scores list
  ctx.font = "16px system-ui";
  players.forEach((p, i) => {
    const py = cy + 25 + i * 28;
    const label = p.id === view.myId ? "You" : p.name;
    ctx.fillStyle = p.color;
    ctx.fillText(`${label}: ${p.score}`, cx, py);
  });
}
