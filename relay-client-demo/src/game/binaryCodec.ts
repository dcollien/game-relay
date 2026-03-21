import type { BroadcastState } from "./state";
import { PLAYER_COLORS } from "./state";

// ── Wire format ──
//
// BROADCAST (host → clients):
//   [flags: u8] [timeRemaining: f32]
//   [playerCount: u8]
//     per player:
//       [idLen: u8] [id: utf8...] [nameLen: u8] [name: utf8...]
//       [x: u16] [y: u16] [colorIdx: u8] [score: u16]
//   [circleCount: u16]
//     per circle:
//       [id: u16] [x: u16] [y: u16] [colorIdx: u8] [ownerIdx: u8]
//
// Positions are stored as uint16 with ×10 precision (0–8000 → 0.0–800.0).
// Colors are indices into PLAYER_COLORS. Unknown colors → index 0.
// Circle "id" is the numeric suffix of "c123" → u16 123.
// Circle "droppedBy" is encoded as ownerIdx into the player list in this packet.
//
// COMMAND (client → host):
//   [type: u8]
//   type 0 (join):  [nameLen: u8] [name: utf8...]
//   type 1 (move):  [x: f32] [y: f32]
//   type 2 (drop):  [x: f32] [y: f32]
//   type 3 (pickup): [circleId: u16] [hostTime: f64]

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const colorToIndex = new Map<string, number>();
for (let i = 0; i < PLAYER_COLORS.length; i++) colorToIndex.set(PLAYER_COLORS[i], i);

function encodePos(v: number): number { return (v * 10) | 0; }
function decodePos(v: number): number { return v / 10; }

// ── Broadcast encoding / decoding ──

export function encodeBroadcast(bs: BroadcastState): ArrayBuffer {
  const playerEntries = Object.entries(bs.players);
  const playerIdToIdx = new Map<string, number>();
  playerEntries.forEach(([id], i) => playerIdToIdx.set(id, i));

  // Pre-encode strings to measure total size
  const encodedPlayers = playerEntries.map(([id, p]) => {
    const idBytes = encoder.encode(id);
    const nameBytes = encoder.encode(p.name);
    return { id, idBytes, nameBytes, p };
  });

  // Header: 1 (flags) + 4 (timeRemaining) + 1 (playerCount)
  let size = 6;
  // Players
  for (const ep of encodedPlayers) {
    // idLen(1) + id + nameLen(1) + name + x(2) + y(2) + colorIdx(1) + score(2)
    size += 1 + ep.idBytes.length + 1 + ep.nameBytes.length + 7;
  }
  // Circles: count(2) + each: id(2) + x(2) + y(2) + colorIdx(1) + ownerIdx(1) = 8
  size += 2 + bs.circles.length * 8;

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let off = 0;

  // Flags
  view.setUint8(off++, bs.gameOver ? 1 : 0);
  // Time remaining
  view.setFloat32(off, bs.timeRemaining); off += 4;
  // Player count
  view.setUint8(off++, playerEntries.length);

  for (const ep of encodedPlayers) {
    view.setUint8(off++, ep.idBytes.length);
    bytes.set(ep.idBytes, off); off += ep.idBytes.length;
    view.setUint8(off++, ep.nameBytes.length);
    bytes.set(ep.nameBytes, off); off += ep.nameBytes.length;
    view.setUint16(off, encodePos(ep.p.x)); off += 2;
    view.setUint16(off, encodePos(ep.p.y)); off += 2;
    view.setUint8(off++, colorToIndex.get(ep.p.color) ?? 0);
    view.setUint16(off, ep.p.score); off += 2;
  }

  // Circles
  view.setUint16(off, bs.circles.length); off += 2;
  for (const c of bs.circles) {
    const numId = parseInt(c.id.slice(1), 10) || 0;
    view.setUint16(off, numId); off += 2;
    view.setUint16(off, encodePos(c.x)); off += 2;
    view.setUint16(off, encodePos(c.y)); off += 2;
    view.setUint8(off++, colorToIndex.get(c.color) ?? 0);
    view.setUint8(off++, playerIdToIdx.get(c.droppedBy) ?? 255);
  }

  return buf;
}

export function decodeBroadcast(buf: ArrayBuffer): BroadcastState {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let off = 0;

  const gameOver = view.getUint8(off++) !== 0;
  const timeRemaining = view.getFloat32(off); off += 4;
  const playerCount = view.getUint8(off++);

  const playerIds: string[] = [];
  const players: BroadcastState["players"] = {};

  for (let i = 0; i < playerCount; i++) {
    const idLen = view.getUint8(off++);
    const id = decoder.decode(bytes.slice(off, off + idLen)); off += idLen;
    const nameLen = view.getUint8(off++);
    const name = decoder.decode(bytes.slice(off, off + nameLen)); off += nameLen;
    const x = decodePos(view.getUint16(off)); off += 2;
    const y = decodePos(view.getUint16(off)); off += 2;
    const colorIdx = view.getUint8(off++);
    const score = view.getUint16(off); off += 2;
    playerIds.push(id);
    players[id] = { x, y, color: PLAYER_COLORS[colorIdx] ?? PLAYER_COLORS[0], score, name };
  }

  const circleCount = view.getUint16(off); off += 2;
  const circles: BroadcastState["circles"] = [];

  for (let i = 0; i < circleCount; i++) {
    const numId = view.getUint16(off); off += 2;
    const x = decodePos(view.getUint16(off)); off += 2;
    const y = decodePos(view.getUint16(off)); off += 2;
    const colorIdx = view.getUint8(off++);
    const ownerIdx = view.getUint8(off++);
    circles.push({
      id: `c${numId}`,
      x, y,
      color: PLAYER_COLORS[colorIdx] ?? PLAYER_COLORS[0],
      droppedBy: playerIds[ownerIdx] ?? "",
    });
  }

  return { players, circles, timeRemaining, gameOver };
}

// ── Command encoding / decoding ──

const CMD_JOIN = 0;
const CMD_MOVE = 1;
const CMD_DROP = 2;
const CMD_PICKUP = 3;

export type BinaryCommand =
  | { type: "join"; name: string }
  | { type: "move"; x: number; y: number }
  | { type: "drop"; x: number; y: number }
  | { type: "pickup"; circleId: string; hostTime: number };

export function encodeCommand(cmd: BinaryCommand): ArrayBuffer {
  if (cmd.type === "join") {
    const nameBytes = encoder.encode(cmd.name);
    const buf = new ArrayBuffer(2 + nameBytes.length);
    const view = new DataView(buf);
    view.setUint8(0, CMD_JOIN);
    view.setUint8(1, nameBytes.length);
    new Uint8Array(buf).set(nameBytes, 2);
    return buf;
  }
  if (cmd.type === "move") {
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint8(0, CMD_MOVE);
    view.setFloat32(1, cmd.x);
    view.setFloat32(5, cmd.y);
    return buf;
  }
  if (cmd.type === "drop") {
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint8(0, CMD_DROP);
    view.setFloat32(1, cmd.x);
    view.setFloat32(5, cmd.y);
    return buf;
  }
  // pickup
  const numId = parseInt(cmd.circleId.slice(1), 10) || 0;
  const buf = new ArrayBuffer(11);
  const view = new DataView(buf);
  view.setUint8(0, CMD_PICKUP);
  view.setUint16(1, numId);
  view.setFloat64(3, cmd.hostTime);
  return buf;
}

export function decodeCommand(buf: ArrayBuffer): BinaryCommand | null {
  if (buf.byteLength < 1) return null;
  const view = new DataView(buf);
  const type = view.getUint8(0);

  if (type === CMD_JOIN) {
    const nameLen = view.getUint8(1);
    const name = decoder.decode(new Uint8Array(buf, 2, nameLen));
    return { type: "join", name };
  }
  if (type === CMD_MOVE) {
    return { type: "move", x: view.getFloat32(1), y: view.getFloat32(5) };
  }
  if (type === CMD_DROP) {
    return { type: "drop", x: view.getFloat32(1), y: view.getFloat32(5) };
  }
  if (type === CMD_PICKUP) {
    const numId = view.getUint16(1);
    const hostTime = view.getFloat64(3);
    return { type: "pickup", circleId: `c${numId}`, hostTime };
  }
  return null;
}
