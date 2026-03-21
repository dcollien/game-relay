import { useState, useRef } from "react";
import { LobbyScreen } from "./LobbyScreen";
import { GameScreen } from "./GameScreen";

export type Role = "host" | "client";

export function App() {
  const [session, setSession] = useState<{ role: Role; url: string; code: string; playerName: string; binary: boolean } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  if (!session) {
    return <LobbyScreen onStart={(role, url, code, playerName, binary) => setSession({ role, url, code, playerName, binary })} />;
  }

  return (
    <GameScreen
      role={session.role}
      relayUrl={session.url}
      gameCode={session.code}
      playerName={session.playerName}
      binary={session.binary}
      onBack={() => setSession(null)}
    />
  );
}
