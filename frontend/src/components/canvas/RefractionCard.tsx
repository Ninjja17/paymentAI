import React, { useRef, useState, MouseEvent } from 'react';

interface RefractionCardProps {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
}

export const RefractionCard: React.FC<RefractionCardProps> = ({
  children,
  className = '',
  intensity = 1.0,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setCoords({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    });
  };

  const handleMouseLeave = () => {
    setCoords((prev) => ({ ...prev, active: false }));
  };

  return (
    <div
      ref={cardRef}
      className={`refraction-card-container ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Dynamic Specular Lens Refraction Layer */}
      {coords.active && (
        <div
          className="refraction-specular-lens"
          style={{
            position: 'absolute',
            left: coords.x,
            top: coords.y,
            width: `${160 * intensity}px`,
            height: `${160 * intensity}px`,
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            background:
              'radial-gradient(circle, rgba(99, 102, 241, 0.16) 0%, rgba(6, 182, 212, 0.08) 40%, rgba(0,0,0,0) 75%)',
            pointerEvents: 'none',
            mixBlendMode: 'screen',
            transition: 'opacity 0.2s ease',
            zIndex: 1,
          }}
        />
      )}

      {/* Internal interactive content */}
      <div style={{ position: 'relative', zIndex: 2 }}>{children}</div>
    </div>
  );
};
