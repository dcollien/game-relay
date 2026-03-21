import { useState } from "react";
import type { Role } from "./App";

const DEFAULT_URL = "wss://constult-us-game-relay.hf.space/connect";
const DEFAULT_CODE = "CIRCLES";

interface Props {
  onStart: (role: Role, url: string, code: string, playerName: string, binary: boolean) => void;
}

export function LobbyScreen({ onStart }: Props) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [playerName, setPlayerName] = useState("");
  const [binary, setBinary] = useState(false);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Circles</h1>
      <p style={styles.sub}>Drop circles. Pick up others&rsquo; circles. Score points.</p>

      <label style={styles.label}>
        Relay URL
        <input style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>

      <label style={styles.label}>
        Game Code
        <input style={styles.input} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>

      <label style={styles.label}>
        Your Name
        <input style={styles.input} value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Enter a name" />
      </label>

      <label style={{ ...styles.label, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={binary} onChange={(e) => setBinary(e.target.checked)} />
        Binary mode
      </label>

      <div style={styles.buttons}>
        <button style={{ ...styles.btn, ...styles.hostBtn }} onClick={() => onStart("host", url, code, playerName || "Host", binary)}>
          Host Game
        </button>
        <button style={{ ...styles.btn, ...styles.joinBtn }} onClick={() => onStart("client", url, code, playerName || "Player", binary)}>
          Join Game
        </button>
      </div>

      <p style={styles.hint}>
        One player hosts, others join with the same code.<br />
        WASD / Arrow keys to move &middot; Space to drop &middot; Tab for scoreboard
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    padding: 32,
    maxWidth: 420,
  },
  title: { fontSize: 36, fontWeight: 700, letterSpacing: 2 },
  sub: { color: "#aaa", textAlign: "center", fontSize: 14 },
  label: { display: "flex", flexDirection: "column", gap: 4, width: "100%", fontSize: 13, color: "#bbb" },
  input: {
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid #444",
    background: "#222",
    color: "#eee",
    fontSize: 14,
    outline: "none",
  },
  buttons: { display: "flex", gap: 12, marginTop: 8 },
  btn: {
    padding: "10px 24px",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  hostBtn: { background: "#e74c3c", color: "#fff" },
  joinBtn: { background: "#3498db", color: "#fff" },
  hint: { color: "#666", fontSize: 12, textAlign: "center", marginTop: 12, lineHeight: 1.6 },
};
