import { useEffect, useRef } from "react";

export function useRenderLoop(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    let frame = 0;
    function loop() {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawRef.current(ctx);
      frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [canvasRef]);
}
