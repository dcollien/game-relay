import { useState, useRef, useCallback } from "react";
import { LobbyScreen } from "./LobbyScreen";
import { GameScreen } from "./GameScreen";

export type Role = "host" | "client";

export function App() {
  const [session, setSession] = useState<{ role: Role; url: string; code: string; playerName: string; binary: boolean } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const handleBack = useCallback((errorMsg?: string) => {
    setSession(null);
    if (errorMsg) setLastError(errorMsg);
  }, []);

  if (!session) {
    return <LobbyScreen error={lastError} onStart={(role, url, code, playerName, binary) => { setLastError(null); setSession({ role, url, code, playerName, binary }); }} />;
  }

  return (
    <GameScreen
      role={session.role}
      relayUrl={session.url}
      gameCode={session.code}
      playerName={session.playerName}
      binary={session.binary}
      onBack={handleBack}
    />
  );
}
