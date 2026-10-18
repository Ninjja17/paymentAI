import React, { useEffect, useRef } from 'react';

interface CanvasBackgroundProps {
  intakeStage?: string;
  isProcessing?: boolean;
}

export const CanvasBackground: React.FC<CanvasBackgroundProps> = ({
  intakeStage: _intakeStage = 'discovery',
  isProcessing = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Dynamic DPR capping
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Mouse coordinates with smooth lerping
    const mouse = {
      x: width * 0.5,
      y: height * 0.5,
      targetX: width * 0.5,
      targetY: height * 0.5,
      radius: 180,
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.targetX = e.clientX;
      mouse.targetY = e.clientY;
    };

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);

    // Particle nodes for interconnected displacement grid
    const nodeCount = Math.floor(Math.min(width, 1400) / 36);
    const particles: Array<{
      x: number;
      y: number;
      originX: number;
      originY: number;
      vx: number;
      vy: number;
      size: number;
      alpha: number;
    }> = [];

    for (let i = 0; i < nodeCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      particles.push({
        x,
        y,
        originX: x,
        originY: y,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.4 + 0.2,
      });
    }

    // Color theme: Pure stark white & silver monochrome glow
    const getStageColors = () => {
      return { primary: '255, 255, 255', secondary: '200, 200, 220' };
    };

    let step = 0;

    const render = () => {
      step += isProcessing ? 0.04 : 0.015;

      // Smooth mouse lerp
      mouse.x += (mouse.targetX - mouse.x) * 0.08;
      mouse.y += (mouse.targetY - mouse.y) * 0.08;

      ctx.clearRect(0, 0, width, height);

      const colors = getStageColors();

      // Ambient radial glow following pointer (Luminous white fog)
      const radialGradient = ctx.createRadialGradient(
        mouse.x,
        mouse.y,
        0,
        mouse.x,
        mouse.y,
        mouse.radius * 2.2
      );
      radialGradient.addColorStop(0, `rgba(${colors.primary}, ${isProcessing ? 0.14 : 0.07})`);
      radialGradient.addColorStop(0.5, `rgba(${colors.secondary}, 0.02)`);
      radialGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = radialGradient;
      ctx.fillRect(0, 0, width, height);

      // Render particle field with force-field repulsion
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Ambient drift
        p.x += p.vx;
        p.y += p.vy;

        // Boundary bounce
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // Mouse displacement force field
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < mouse.radius) {
          const force = (1 - dist / mouse.radius) * 18;
          const angle = Math.atan2(dy, dx);
          p.x += Math.cos(angle) * force;
          p.y += Math.sin(angle) * force;
        }

        // Return to origin damping
        p.x += (p.originX - p.x) * 0.02;
        p.y += (p.originY - p.y) * 0.02;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors.primary}, ${p.alpha * (isProcessing ? 1.5 : 1)})`;
        ctx.fill();

        // Connect nearby particles with subtle grid lines
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist2 = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist2 < 95) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(${colors.primary}, ${(1 - dist2 / 95) * 0.15})`;
            ctx.lineWidth = 0.75;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, [_intakeStage, isProcessing]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-ui-background"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity: 0.9,
      }}
    />
  );
};
