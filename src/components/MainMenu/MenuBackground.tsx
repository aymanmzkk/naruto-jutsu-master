import { useEffect, useRef } from 'react';

/** Lightweight 2D canvas: rising embers, drifting ash and floating leaves. */
export function MenuBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    type P = { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; kind: 0 | 1 | 2; rot: number };
    const ps: P[] = [];
    const spawn = (initial = false): P => {
      const kind = (Math.random() < 0.72 ? 0 : Math.random() < 0.75 ? 1 : 2) as 0 | 1 | 2;
      return {
        x: Math.random() * w,
        y: initial ? Math.random() * h : h + 20,
        vx: (Math.random() - 0.5) * 0.25,
        vy: kind === 2 ? -0.3 - Math.random() * 0.3 : -0.35 - Math.random() * 0.9,
        r: kind === 0 ? 0.8 + Math.random() * 2.2 : kind === 1 ? 1 + Math.random() * 2 : 5 + Math.random() * 4,
        life: 0,
        max: 400 + Math.random() * 600,
        kind,
        rot: Math.random() * 6,
      };
    };
    for (let i = 0; i < 140; i++) ps.push(spawn(true));

    let t = 0;
    const frame = () => {
      t += 1;
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life++;
        p.x += p.vx + Math.sin((t + i * 40) * 0.01) * 0.3;
        p.y += p.vy;
        p.rot += 0.01;
        const a = Math.min(1, p.life / 60) * Math.max(0, 1 - p.life / p.max);
        if (p.kind === 0) {
          const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
          grd.addColorStop(0, `rgba(255,190,110,${0.9 * a})`);
          grd.addColorStop(0.3, `rgba(255,110,30,${0.5 * a})`);
          grd.addColorStop(1, 'rgba(255,60,0,0)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
          g.fill();
        } else if (p.kind === 1) {
          g.fillStyle = `rgba(160,140,130,${0.25 * a})`;
          g.fillRect(p.x, p.y, p.r, p.r);
        } else {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = `rgba(120,30,20,${0.45 * a})`;
          g.beginPath();
          g.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        if (p.life > p.max || p.y < -30) ps[i] = spawn();
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="menu-bg" aria-hidden>
      <div className="menu-bg__moon" />
      <div className="menu-bg__mist" />
      <div className="menu-bg__kanji kanji">忍</div>
      <svg className="menu-bg__brush" viewBox="0 0 1200 300" preserveAspectRatio="none">
        <path d="M0 220 C200 160 380 260 600 200 S1000 140 1200 210 L1200 300 L0 300 Z" fill="rgba(90,12,12,0.35)" />
        <path d="M0 250 C240 210 420 280 640 240 S980 200 1200 250 L1200 300 L0 300 Z" fill="rgba(20,6,8,0.9)" />
      </svg>
      <canvas ref={ref} className="menu-bg__canvas" />
    </div>
  );
}
