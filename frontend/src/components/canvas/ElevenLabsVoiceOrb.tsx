import React, { useEffect, useRef } from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface ElevenLabsVoiceOrbProps {
  state?: OrbState;
  size?: number;
  onClick?: () => void;
  className?: string;
}

export const ElevenLabsVoiceOrb: React.FC<ElevenLabsVoiceOrbProps> = ({
  state = 'idle',
  size = 180,
  onClick,
  className = '',
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

    const cx = size / 2;
    const cy = size / 2;
    const baseRadius = size * 0.32;

    // Simulation nodes for organic liquid mesh boundary
    const pointsCount = 48;

    const render = () => {
      // Speed multiplier based on state
      const speed = state === 'speaking' ? 0.05 : state === 'listening' ? 0.04 : state === 'thinking' ? 0.06 : 0.02;
      t += speed;

      ctx.clearRect(0, 0, size, size);

      // 1. Ambient outer glowing aura (Intense radiant white & silver luminescence)
      const auraGradient = ctx.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, size * 0.49);
      if (state === 'speaking') {
        auraGradient.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
        auraGradient.addColorStop(0.35, 'rgba(230, 230, 240, 0.35)');
        auraGradient.addColorStop(0.7, 'rgba(200, 200, 220, 0.12)');
        auraGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (state === 'listening') {
        auraGradient.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        auraGradient.addColorStop(0.4, 'rgba(215, 215, 230, 0.3)');
        auraGradient.addColorStop(0.75, 'rgba(180, 180, 200, 0.1)');
        auraGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (state === 'thinking') {
        auraGradient.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
        auraGradient.addColorStop(0.4, 'rgba(190, 190, 210, 0.25)');
        auraGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        // Idle breathing luminescence
        const breathAlpha = 0.4 + Math.sin(t * 1.5) * 0.15;
        auraGradient.addColorStop(0, `rgba(255, 255, 255, ${breathAlpha})`);
        auraGradient.addColorStop(0.45, `rgba(220, 220, 235, ${breathAlpha * 0.4})`);
        auraGradient.addColorStop(0.8, 'rgba(160, 160, 180, 0.05)');
        auraGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }

      ctx.fillStyle = auraGradient;
      ctx.fillRect(0, 0, size, size);

      // 2. Liquid organic orb geometry with perlin-like trigonometric noise
      ctx.beginPath();
      for (let i = 0; i <= pointsCount; i++) {
        const angle = (i / pointsCount) * Math.PI * 2;
        
        let noise = 0;
        if (state === 'speaking') {
          noise =
            Math.sin(angle * 3 + t * 2) * 6.5 +
            Math.cos(angle * 5 - t * 3) * 4.5 +
            Math.sin(angle * 2 + t) * 3.5;
        } else if (state === 'listening') {
          noise =
            Math.sin(angle * 4 + t * 3) * 5.5 +
            Math.cos(angle * 2 - t * 2) * 4.5;
        } else if (state === 'thinking') {
          noise =
            Math.sin(angle * 6 + t * 4) * 4.5 +
            Math.cos(angle * 3 + t * 3) * 5.5;
        } else {
          // Idle breathing
          noise = Math.sin(angle * 3 + t) * 2.8 + Math.cos(angle * 2 - t) * 2.2;
        }

        const r = baseRadius + noise;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();

      // Fluid interior gradient (Liquid Chrome Pearl / Ethereal Silver)
      const orbGrad = ctx.createLinearGradient(
        cx - baseRadius * 0.9,
        cy - baseRadius * 0.9,
        cx + baseRadius * 0.9,
        cy + baseRadius * 0.9
      );

      if (state === 'speaking') {
        orbGrad.addColorStop(0, '#ffffff');
        orbGrad.addColorStop(0.25, '#f4f4f5');
        orbGrad.addColorStop(0.55, '#d4d4d8');
        orbGrad.addColorStop(0.85, '#71717a');
        orbGrad.addColorStop(1, '#18181b');
      } else if (state === 'listening') {
        orbGrad.addColorStop(0, '#ffffff');
        orbGrad.addColorStop(0.3, '#e4e4e7');
        orbGrad.addColorStop(0.65, '#a1a1aa');
        orbGrad.addColorStop(1, '#27272a');
      } else if (state === 'thinking') {
        orbGrad.addColorStop(0, '#f4f4f5');
        orbGrad.addColorStop(0.35, '#d4d4d8');
        orbGrad.addColorStop(0.7, '#71717a');
        orbGrad.addColorStop(1, '#09090b');
      } else {
        orbGrad.addColorStop(0, '#ffffff');
        orbGrad.addColorStop(0.3, '#e4e4e7');
        orbGrad.addColorStop(0.7, '#52525b');
        orbGrad.addColorStop(1, '#18181b');
      }

      ctx.fillStyle = orbGrad;
      // High-intensity stark white glow shadow
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = state === 'idle' ? 26 : 42;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 3. Inner specular refraction highlight (Liquid gloss crest)
      ctx.beginPath();
      ctx.arc(cx - baseRadius * 0.28, cy - baseRadius * 0.28, baseRadius * 0.46, 0, Math.PI * 2);
      const specGrad = ctx.createRadialGradient(
        cx - baseRadius * 0.35,
        cy - baseRadius * 0.35,
        0,
        cx - baseRadius * 0.25,
        cy - baseRadius * 0.25,
        baseRadius * 0.5
      );
      specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      specGrad.addColorStop(0.4, 'rgba(255, 255, 255, 0.35)');
      specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = specGrad;
      ctx.fill();

      // 4. Subtle acoustic soundwave rings when active (Glowing pure white rings)
      if (state === 'speaking' || state === 'listening') {
        const ringCount = 2;
        for (let j = 1; j <= ringCount; j++) {
          const ringR = baseRadius + j * 15 + (Math.sin(t * 3 + j) * 4);
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.65 / j})`;
          ctx.lineWidth = 1.5;
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [state, size]);

  return (
    <div
      className={`elevenlabs-orb-wrapper ${className}`}
      onClick={onClick}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: 'block',
        }}
      />
    </div>
  );
};
