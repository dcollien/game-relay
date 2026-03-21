import { useEffect, useRef } from "react";
import type { Role } from "./App";
import { drawGame, drawScoreboard } from "./game/renderer";
import { CANVAS_W, CANVAS_H } from "./game/state";
import { useGameSession } from "./hooks/useGameSession";
import { useRenderLoop } from "./hooks/useRenderLoop";
import { useKeyToggle } from "./hooks/useKeyToggle";

interface Props {
  role: Role;
  relayUrl: string;
  gameCode: string;
  playerName: string;
  binary: boolean;
  onBack: (errorMsg?: string) => void;
}

export function GameScreen({ role, relayUrl, gameCode, playerName, binary, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showScoreboard, setShowScoreboard] = useKeyToggle("Tab");
  const { player, status, error } = useGameSession(role, relayUrl, gameCode, playerName, binary);

  useEffect(() => {
    if (error) onBack(error);
  }, [error, onBack]);

  useRenderLoop(canvasRef, (ctx) => {
    const view = player.current?.view;
    if (!view) return;
    drawGame(ctx, view);
    if (showScoreboard) drawScoreboard(ctx, view);
  });

  return (
    <div style={styles.wrapper}>
      <div style={styles.topBar}>
        <button style={styles.backBtn} onClick={() => onBack()}>← Leave</button>
        <span style={styles.code}>{gameCode}</span>
        {status && <span style={styles.status}>{status}</span>}
        <button
          style={styles.scoreBtn}
          onClick={() => setShowScoreboard((p) => !p)}
        >
          {showScoreboard ? "Hide Scores" : "Scores"}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={styles.canvas}
        tabIndex={0}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  topBar: { display: "flex", alignItems: "center", gap: 12, width: CANVAS_W, padding: "4px 0" },
  backBtn: {
    background: "none", border: "1px solid #555", borderRadius: 6,
    color: "#ccc", padding: "4px 12px", cursor: "pointer", fontSize: 13,
  },
  code: { color: "#888", fontSize: 13, fontFamily: "monospace" },
  status: { color: "#f1c40f", fontSize: 13, flex: 1 },
  scoreBtn: {
    marginLeft: "auto", background: "none", border: "1px solid #555", borderRadius: 6,
    color: "#ccc", padding: "4px 12px", cursor: "pointer", fontSize: 13,
  },
  canvas: { borderRadius: 8, border: "1px solid #333", cursor: "crosshair" },
};
