import { useEffect, useRef } from 'react';
import { getHandTracker } from '../../gestures/HandTracker';
import { HAND_CONNECTIONS, type TrackingFrame } from '../../gestures/types';
import { settingsStore } from '../../state/settingsStore';
import { useStore } from '../../state/createStore';

/**
 * Mirrored webcam view with the real-time hand skeleton (21 landmarks per
 * hand + bone connections) drawn on top. Used in the HUD and the NUI LAB.
 */

const COLORS = { Left: '#4fc3ff', Right: '#ff8a3c' };
const FINGER_TIPS = new Set([4, 8, 12, 16, 20]);

export function drawHands(
  g: CanvasRenderingContext2D,
  frame: TrackingFrame | null,
  w: number,
  h: number,
  opts: { landmarks: boolean; connections: boolean; labels: boolean; scale?: number },
) {
  g.clearRect(0, 0, w, h);
  if (!frame) return;
  const s = opts.scale ?? 1;
  for (const hand of frame.hands) {
    const col = COLORS[hand.handedness];
    // mirrored like the video
    const pts = hand.landmarks.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));
    if (opts.connections) {
      g.strokeStyle = col;
      g.lineWidth = 2.4 * s;
      g.shadowColor = col;
      g.shadowBlur = 8 * s;
      g.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        g.moveTo(pts[a].x, pts[a].y);
        g.lineTo(pts[b].x, pts[b].y);
      }
      g.stroke();
      g.shadowBlur = 0;
    }
    if (opts.landmarks) {
      pts.forEach((p, i) => {
        g.beginPath();
        g.fillStyle = FINGER_TIPS.has(i) ? '#ffffff' : col;
        g.arc(p.x, p.y, (FINGER_TIPS.has(i) ? 4.2 : 3.2) * s, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.stroke();
      });
    }
    if (opts.labels) {
      const wr = pts[0];
      g.font = `700 ${13 * s}px Rajdhani, sans-serif`;
      const label = `${hand.handedness.toUpperCase()} ${(hand.score * 100).toFixed(0)}%`;
      const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(wr.x - tw / 2 - 6, wr.y + 8 * s, tw + 12, 18 * s);
      g.fillStyle = col;
      g.fillText(label, wr.x - tw / 2, wr.y + 22 * s);
    }
  }
}

export function WebcamPreview({ className = '', labels = false, scale = 1 }: { className?: string; labels?: boolean; scale?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracker = getHandTracker();
  const status = useStore(tracker.state, (s) => s.status);
  const showLm = useStore(settingsStore, (s) => s.debug.showLandmarks);
  const showCon = useStore(settingsStore, (s) => s.debug.showConnections);

  useEffect(() => {
    const v = videoRef.current!;
    if (tracker.stream && v.srcObject !== tracker.stream) {
      v.srcObject = tracker.stream;
      v.play().catch(() => undefined);
    }
  }, [status, tracker]);

  useEffect(() => {
    const c = canvasRef.current!;
    const g = c.getContext('2d')!;
    const draw = (f: TrackingFrame | null) => {
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      drawHands(g, f, w, h, { landmarks: showLm, connections: showCon, labels, scale });
    };
    draw(tracker.latest);
    return tracker.onFrame(draw);
  }, [tracker, showLm, showCon, labels, scale]);

  return (
    <div className={`webcam ${className}`}>
      <video ref={videoRef} muted playsInline className="webcam__video" />
      <canvas ref={canvasRef} className="webcam__canvas" />
      {status !== 'running' && (
        <div className="webcam__off">
          <span>{status === 'loading-model' ? 'LOADING MODEL…' : status === 'requesting-camera' ? 'WAITING FOR CAMERA…' : 'CAMERA OFF'}</span>
        </div>
      )}
    </div>
  );
}
