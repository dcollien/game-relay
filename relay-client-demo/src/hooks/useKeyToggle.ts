import { useEffect, useState } from "react";

export function useKeyToggle(key: string, initial = false) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === key) {
        e.preventDefault();
        setValue((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);

  return [value, setValue] as const;
}
