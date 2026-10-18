import React, { useEffect, useRef } from 'react';

interface VoiceAuraCanvasProps {
  active?: boolean;
  size?: number;
}

export const VoiceAuraCanvas: React.FC<VoiceAuraCanvasProps> = ({
  active = false,
  size = 48,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let t = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      t += active ? 0.08 : 0.03;
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.35;

      // Draw multi-harmonic acoustic rings
      const rings = active ? 4 : 2;
      for (let r = 0; r < rings; r++) {
        const offset = (r * Math.PI) / 3;
        const radius = baseR + Math.sin(t + offset) * (active ? 6 : 2.5);

        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, radius), 0, Math.PI * 2);

        if (active) {
          ctx.strokeStyle = r % 2 === 0 ? 'rgba(99, 102, 241, 0.7)' : 'rgba(6, 182, 212, 0.7)';
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }

      // Center glowing core
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.12 + (active ? Math.sin(t * 2) * 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle = active ? '#38bdf8' : '#818cf8';
      ctx.shadowColor = active ? '#06b6d4' : '#6366f1';
      ctx.shadowBlur = active ? 12 : 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [active, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
    />
  );
};
