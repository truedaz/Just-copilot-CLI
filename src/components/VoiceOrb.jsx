import { useEffect, useRef } from 'react';

const BAR_COUNT = 32; // segments in the sound-ring around the orb

/**
 * Animated fullscreen voice overlay — the ChatGPT-style orb.
 *
 * voiceState: 'idle' | 'listening' | 'thinking' | 'speaking'
 * volumeRef:  React ref whose .current is 0–1 mic amplitude, updated each frame
 */
export default function VoiceOrb({ voiceState, transcript, subtitle, onExit, volumeRef }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const frameRef = useRef(0);
  const smoothRadiusRef = useRef(60); // lerped display radius

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const S = canvas.width; // 280
    const cx = S / 2;
    const cy = S / 2;

    const draw = () => {
      frameRef.current++;
      const t = frameRef.current * 0.04;
      const vol = volumeRef?.current ?? 0; // 0..1 real mic amplitude

      ctx.clearRect(0, 0, S, S);

      // ── target radius + colour based on state & live volume ──────────────
      let baseRadius = 60;
      let glowAlpha = 0.15;
      let color = '#565869'; // idle grey

      if (voiceState === 'listening') {
        color = '#10a37f'; // green
        baseRadius = 60 + Math.sin(t * 1.5) * 4 + vol * 38;
        glowAlpha = 0.25 + vol * 0.45;
      } else if (voiceState === 'thinking') {
        color = '#8b5cf6'; // purple
        baseRadius = 60 + Math.sin(t * 3) * 5;
        glowAlpha = 0.18 + Math.sin(t * 2) * 0.06;
      } else if (voiceState === 'speaking') {
        color = '#3b82f6'; // blue
        baseRadius = 60 + Math.sin(t * 4) * 14 + Math.sin(t * 7.3) * 6;
        glowAlpha = 0.38 + Math.sin(t * 3) * 0.14;
      }

      // Lerp so the orb swells/shrinks smoothly instead of snapping
      smoothRadiusRef.current += (baseRadius - smoothRadiusRef.current) * 0.18;
      const radius = smoothRadiusRef.current;

      // ── sound-ring bars (listening only, above noise floor) ──────────────
      if (voiceState === 'listening' && vol > 0.02) {
        const ringR = radius + 16;
        const barMaxH = 26 * vol;
        ctx.save();
        for (let i = 0; i < BAR_COUNT; i++) {
          const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
          const wave = Math.sin(t * 6 + (i / BAR_COUNT) * Math.PI * 2) * 0.5 + 0.5;
          const barH = 3 + barMaxH * wave;
          const x1 = cx + Math.cos(angle) * ringR;
          const y1 = cy + Math.sin(angle) * ringR;
          const x2 = cx + Math.cos(angle) * (ringR + barH);
          const y2 = cy + Math.sin(angle) * (ringR + barH);
          const alpha = Math.round((0.28 + wave * 0.55) * 255).toString(16).padStart(2, '0');
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = color + alpha;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── outer glow halo ──────────────────────────────────────────────────
      const glowHex = Math.round(Math.min(1, glowAlpha) * 255).toString(16).padStart(2, '0');
      const grd = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 2.2);
      grd.addColorStop(0, color + glowHex);
      grd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // ── core orb with inner highlight ────────────────────────────────────
      const core = ctx.createRadialGradient(
        cx - radius * 0.25, cy - radius * 0.25, 0,
        cx, cy, radius,
      );
      core.addColorStop(0, lighten(color, 70));
      core.addColorStop(1, color);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [voiceState, volumeRef]);

  const stateLabel = {
    idle: 'Tap mic to start',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking',
  }[voiceState] ?? '';

  return (
    <div className="voice-overlay">
      <button className="voice-exit-btn" onClick={onExit} title="Exit voice mode">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <canvas ref={canvasRef} width={280} height={280} className="voice-canvas" />

      <p className="voice-state-label">{stateLabel}</p>

      <div className="voice-text-area">
        {voiceState === 'listening' && transcript && (
          <p className="voice-transcript">"{transcript}"</p>
        )}
        {voiceState === 'speaking' && subtitle && (
          <p className="voice-subtitle">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function lighten(hex, amount) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}
