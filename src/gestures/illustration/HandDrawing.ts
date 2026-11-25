import type { Handedness, Vec3 } from '../types';
import { rotateAxis, solveHandJoints, type TwoHandPose } from '../SyntheticHand';
import { add3, angle3, clamp, cross3, dot3, norm3, scale3, sub3 } from '../../utils/math';

/**
 * HAND DRAWING — turns a sign's reference pose (21 joints per hand, the same
 * data the recognizer is tested against) into a clean 2D instruction drawing.
 *
 *  • Mirror view: what you would see in a mirror / in the webcam preview, so
 *    the left hand is drawn on the left. Optional yaw/pitch per sign.
 *  • Every finger segment is a tapered capsule; segments of a straight finger
 *    are merged into one outlined silhouette, bent joints are split so the
 *    painter's algorithm (far → near) handles fists and interlocked fingers.
 *  • Details: fingernails when the back of a finger faces you, palm lines when
 *    the palm faces you, knuckles on the back of the hand, sleeves with a
 *    coloured cuff (blue = left, orange = right).
 */

export interface P2 {
  x: number;
  y: number;
}

export interface DetailLine {
  d: string;
  width: number;
  opacity: number;
  /** 'nail' = filled nail shape, otherwise a stroked line. */
  fill?: 'nail';
  transform?: string;
}

export interface DrawLayer {
  depth: number;
  kind: 'skin' | 'sleeve' | 'cuff';
  side: Handedness;
  /** Closed shapes forming one silhouette (outlined as a union). */
  shapes: string[];
  /** 0 = nearest, 1 = farthest (used to shade). */
  shade: number;
  details: DetailLine[];
}

export interface HandDrawingResult {
  viewBox: [number, number, number, number];
  layers: DrawLayer[];
  labels: { side: Handedness; x: number; y: number }[];
  /** Base unit for stroke widths (≈1.2% of the view size). */
  unit: number;
}

export interface DrawingView {
  yaw: number;
  pitch: number;
}

const FINGERS: { base: number; radii: number[] }[] = [
  { base: 1, radii: [0.0175, 0.0135, 0.0118, 0.0102] }, // thumb (CMC, MCP, IP, tip)
  { base: 5, radii: [0.0112, 0.0102, 0.0093, 0.0083] },
  { base: 9, radii: [0.0116, 0.0106, 0.0096, 0.0085] },
  { base: 13, radii: [0.0108, 0.0098, 0.0089, 0.008] },
  { base: 17, radii: [0.0096, 0.0087, 0.0078, 0.007] },
];

const X: Vec3 = { x: 1, y: 0, z: 0 };
const Y: Vec3 = { x: 0, y: 1, z: 0 };
const TO_VIEWER: Vec3 = { x: 0, y: 0, z: -1 };
const MM = 1000;

/* ---------------- 2D geometry ---------------- */

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function circlePath(c: P2, r: number) {
  return `M${fmt(c.x - r)} ${fmt(c.y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`;
}

/** Outline of the convex hull of two circles (a tapered capsule). */
function capsulePath(a: P2, ra: number, b: P2, rb: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < Math.abs(ra - rb) + 0.01) return ra >= rb ? circlePath(a, ra) : circlePath(b, rb);
  const th = Math.atan2(dy, dx);
  const al = Math.acos(clamp((ra - rb) / d, -1, 1));
  const pts: string[] = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const ang = th + al + ((2 * Math.PI - 2 * al) * i) / N;
    pts.push(`${fmt(a.x + ra * Math.cos(ang))} ${fmt(a.y + ra * Math.sin(ang))}`);
  }
  for (let i = 0; i <= N; i++) {
    const ang = th - al + (2 * al * i) / N;
    pts.push(`${fmt(b.x + rb * Math.cos(ang))} ${fmt(b.y + rb * Math.sin(ang))}`);
  }
  return `M${pts.join('L')}Z`;
}

function convexHull(points: P2[]): P2[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Smooth closed curve through the points (Catmull-Rom → cubic Bézier). */
function smoothClosed(pts: P2[], tension = 0.85) {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension };
    d += `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d + 'Z';
}

function quadCurve(a: P2, c: P2, b: P2) {
  return `M${fmt(a.x)} ${fmt(a.y)}Q${fmt(c.x)} ${fmt(c.y)} ${fmt(b.x)} ${fmt(b.y)}`;
}

/* ---------------- projection ---------------- */

interface Projected {
  p: P2;
  z: number;
  k: number;
}

function makeProjector(center: Vec3, view: DrawingView) {
  const rot = (v: Vec3) => rotateAxis(rotateAxis(v, Y, view.yaw), X, view.pitch);
  return {
    rot,
    /** player frame point → rotated frame (meters, around the centre) */
    toView: (p: Vec3) => rot(sub3(p, center)),
    /** rotated frame point → mirror-view 2D (mm) with mild perspective */
    project: (v: Vec3): Projected => {
      const k = 1 / (1 + clamp(v.z, -0.3, 0.3) * 0.9);
      return { p: { x: v.x * k * MM, y: -v.y * k * MM }, z: v.z, k };
    },
  };
}

/* ---------------- main ---------------- */

export function drawHands(pose: TwoHandPose, view: DrawingView = { yaw: 20, pitch: 10 }): HandDrawingResult {
  const hands: { side: Handedness; joints: Vec3[] }[] = [];
  if (pose.left) hands.push({ side: 'Left', joints: solveHandJoints(pose.left, 'Left') });
  if (pose.right) hands.push({ side: 'Right', joints: solveHandJoints(pose.right, 'Right') });

  const all = hands.flatMap((h) => h.joints);
  const center = scale3(all.reduce((a, b) => add3(a, b), { x: 0, y: 0, z: 0 }), 1 / all.length);
  const P = makeProjector(center, view);

  const layers: DrawLayer[] = [];
  const labels: HandDrawingResult['labels'] = [];
  const bounds: P2[] = [];
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const { side, joints } of hands) {
    // where the forearm goes (player frame): elbows low at the body sides; when
    // the hand points down (bent wrist) the forearm comes in from the side.
    const sideSign0 = side === 'Right' ? 1 : -1;
    const dirPlayer = norm3(sub3(joints[9], joints[0]));
    const elbowPlayer =
      dirPlayer.y < -0.35
        ? add3(joints[0], { x: sideSign0 * 0.24, y: -0.03, z: 0.12 })
        : { x: center.x + sideSign0 * 0.2, y: center.y - 0.36, z: center.z + 0.14 };
    const J = joints.map(P.toView);
    const pj = J.map(P.project);
    J.forEach((v) => {
      zMin = Math.min(zMin, v.z);
      zMax = Math.max(zMax, v.z);
    });

    const radial = norm3(sub3(J[5], J[17])); // little finger → index finger
    const handDir = norm3(sub3(J[9], J[0]));
    let n = norm3(cross3(sub3(J[5], J[0]), sub3(J[17], J[0])));
    if (side === 'Left') n = scale3(n, -1); // n points out of the palm
    const palmVis = dot3(n, TO_VIEWER);

    /* ---- sleeve (forearm) ---- */
    const elbow = P.toView(elbowPlayer);
    const wristBack = add3(J[0], scale3(handDir, -0.012));
    const forearmDir = norm3(sub3(elbow, wristBack));
    const sleeveStart = add3(wristBack, scale3(forearmDir, 0.03));
    const ws = P.project(sleeveStart);
    const es = P.project(elbow);
    layers.push({
      depth: (sleeveStart.z + elbow.z) / 2 + 0.05,
      kind: 'sleeve',
      side,
      shapes: [capsulePath(ws.p, 0.031 * ws.k * MM, es.p, 0.042 * es.k * MM)],
      shade: 0,
      details: [],
    });
    // cuff (coloured wrap) between the wrist and the sleeve
    const cuffA = P.project(add3(wristBack, scale3(forearmDir, 0.004)));
    const cuffB = P.project(add3(wristBack, scale3(forearmDir, 0.036)));
    layers.push({
      depth: (wristBack.z + sleeveStart.z) / 2 + 0.03,
      kind: 'cuff',
      side,
      shapes: [capsulePath(cuffA.p, 0.026 * cuffA.k * MM, cuffB.p, 0.031 * cuffB.k * MM)],
      shade: 0,
      details: [],
    });
    const lab = P.project(add3(wristBack, scale3(forearmDir, 0.075)));
    labels.push({ side, x: lab.p.x, y: lab.p.y });

    /* ---- palm ---- */
    const palmPoly: Vec3[] = [
      add3(J[0], scale3(radial, 0.021)), // wrist, thumb side
      add3(J[0], scale3(radial, -0.024)), // wrist, little-finger side
      add3(add3(J[17], scale3(radial, -0.009)), scale3(handDir, -0.03)), // hypothenar
      add3(J[17], scale3(radial, -0.008)),
      J[17],
      J[13],
      J[9],
      J[5],
      add3(J[5], scale3(radial, 0.008)),
    ];
    const palmPts: P2[] = [];
    for (const v of palmPoly) {
      for (const s of [-1, 1]) palmPts.push(P.project(add3(v, scale3(n, 0.0115 * s))).p);
    }
    const hull = convexHull(palmPts);
    const palmDepth = palmPoly.reduce((a, v) => a + v.z, 0) / palmPoly.length;
    const palmDetails: DetailLine[] = [];
    const u = (v: Vec3) => P.project(add3(v, scale3(n, 0.0118))).p;
    if (palmVis > 0.25) {
      const op = clamp((palmVis - 0.25) * 1.6, 0, 0.55);
      const lerp3 = (a: Vec3, b: Vec3, t: number) => add3(a, scale3(sub3(b, a), t));
      // heart line, head line, life line
      const h1 = lerp3(lerp3(J[17], J[0], 0.24), J[13], 0.05);
      const h2 = lerp3(lerp3(J[9], J[5], 0.5), J[0], 0.2);
      palmDetails.push({ d: quadCurve(u(h1), u(lerp3(lerp3(J[13], J[9], 0.5), J[0], 0.32)), u(h2)), width: 1, opacity: op });
      const m1 = lerp3(lerp3(J[5], J[1], 0.5), J[0], 0.18);
      const m2 = lerp3(lerp3(J[17], J[0], 0.55), J[13], 0.1);
      palmDetails.push({ d: quadCurve(u(m1), u(lerp3(lerp3(J[9], J[13], 0.5), J[0], 0.48)), u(m2)), width: 1, opacity: op * 0.9 });
      const l1 = lerp3(J[5], J[1], 0.45);
      const l2 = lerp3(J[0], J[1], 0.15);
      palmDetails.push({ d: quadCurve(u(l1), u(lerp3(lerp3(J[1], J[9], 0.35), J[0], 0.25)), u(l2)), width: 1, opacity: op * 0.85 });
    } else if (palmVis < -0.3) {
      // knuckles on the back of the hand
      const op = clamp((-palmVis - 0.3) * 1.4, 0, 0.45);
      for (const j of [5, 9, 13, 17]) {
        const c = P.project(add3(J[j], scale3(n, -0.012)));
        const along = P.project(add3(add3(J[j], scale3(n, -0.012)), scale3(handDir, 0.01))).p;
        const dir = { x: along.x - c.p.x, y: along.y - c.p.y };
        const len = Math.hypot(dir.x, dir.y) || 1;
        const perp = { x: (-dir.y / len) * 4.5 * c.k, y: (dir.x / len) * 4.5 * c.k };
        palmDetails.push({
          d: quadCurve({ x: c.p.x - perp.x, y: c.p.y - perp.y }, { x: c.p.x - (dir.x / len) * 3, y: c.p.y - (dir.y / len) * 3 }, { x: c.p.x + perp.x, y: c.p.y + perp.y }),
          width: 1,
          opacity: op,
        });
      }
    }
    layers.push({ depth: palmDepth, kind: 'skin', side, shapes: [smoothClosed(hull)], shade: 0, details: palmDetails });

    /* ---- fingers ---- */
    for (const f of FINGERS) {
      const idx = f.base === 1 ? [1, 2, 3, 4] : [f.base, f.base + 1, f.base + 2, f.base + 3];
      const pts = idx.map((i) => J[i]);
      const proj = idx.map((i) => pj[i]);
      const radii = f.radii.map((r, i) => r * proj[i].k * MM);
      // split where the finger bends a lot so depth sorting stays correct
      const groups: number[][] = [];
      let cur: number[] = [0];
      for (const s of [1, 2]) {
        const bend = angle3(sub3(pts[s], pts[s - 1]), sub3(pts[s + 1], pts[s]));
        if (bend > 32) {
          groups.push(cur);
          cur = [s];
        } else cur.push(s);
      }
      groups.push(cur);

      for (const g of groups) {
        const shapes: string[] = [];
        const details: DetailLine[] = [];
        let depth = 0;
        for (const s of g) {
          shapes.push(capsulePath(proj[s].p, radii[s], proj[s + 1].p, radii[s + 1]));
          depth += (pts[s].z + pts[s + 1].z) / 2;
        }
        // thumb base blends into the palm (thenar)
        if (f.base === 1 && g[0] === 0) {
          const base = P.project(add3(J[0], scale3(radial, 0.014)));
          shapes.push(capsulePath(base.p, 0.017 * base.k * MM, proj[0].p, radii[0]));
        }
        depth /= g.length;
        // crease lines on straight joints inside the group
        for (const s of g) {
          if (s === g[0]) continue;
          const a = proj[s - 1].p;
          const b = proj[s + 1].p;
          const c = proj[s].p;
          const dir = { x: b.x - a.x, y: b.y - a.y };
          const len = Math.hypot(dir.x, dir.y);
          if (len < radii[s] * 2.2) continue;
          const perp = { x: (-dir.y / len) * radii[s] * 0.55, y: (dir.x / len) * radii[s] * 0.55 };
          details.push({ d: `M${fmt(c.x - perp.x)} ${fmt(c.y - perp.y)}L${fmt(c.x + perp.x)} ${fmt(c.y + perp.y)}`, width: 0.9, opacity: 0.32 });
        }
        // fingernail on the distal segment when its back faces the viewer
        if (g.includes(2)) {
          const segDir = norm3(sub3(pts[3], pts[2]));
          let dorsal = side === 'Right' ? norm3(cross3(segDir, radial)) : norm3(cross3(radial, segDir));
          if (f.base === 1) dorsal = norm3(add3(dorsal, scale3(radial, 0.6)));
          const vis = dot3(dorsal, TO_VIEWER);
          if (vis > 0.12) {
            const r = f.radii[3];
            const c3 = add3(add3(pts[2], scale3(sub3(pts[3], pts[2]), 0.72)), scale3(dorsal, r * 0.55));
            const tipSide = P.project(add3(c3, scale3(segDir, r * 0.85)));
            const baseSide = P.project(add3(c3, scale3(segDir, -r * 0.65)));
            const cc = P.project(c3);
            const L = Math.hypot(tipSide.p.x - baseSide.p.x, tipSide.p.y - baseSide.p.y);
            const W = r * 0.72 * MM * cc.k * (0.55 + 0.45 * vis);
            if (L > 1.2) {
              const ang = (Math.atan2(tipSide.p.y - baseSide.p.y, tipSide.p.x - baseSide.p.x) * 180) / Math.PI;
              const mx = (tipSide.p.x + baseSide.p.x) / 2;
              const my = (tipSide.p.y + baseSide.p.y) / 2;
              details.push({
                d: `M${fmt(-L / 2)} 0a${fmt(L / 2)} ${fmt(W)} 0 1 0 ${fmt(L)} 0a${fmt(L / 2)} ${fmt(W)} 0 1 0 ${fmt(-L)} 0Z`,
                transform: `translate(${fmt(mx)} ${fmt(my)}) rotate(${fmt(ang)})`,
                width: 0.8,
                opacity: 0.85 * clamp(vis * 1.6, 0, 1),
                fill: 'nail',
              });
            }
          }
        }
        layers.push({ depth, kind: 'skin', side, shapes, shade: 0, details });
      }
      proj.forEach((q, i) => bounds.push({ x: q.p.x - radii[i], y: q.p.y - radii[i] }, { x: q.p.x + radii[i], y: q.p.y + radii[i] }));
    }
    hull.forEach((q) => bounds.push(q));
  }

  // far → near; shade by depth
  const span = Math.max(1e-3, zMax - zMin);
  for (const l of layers) l.shade = clamp((l.depth - zMin) / span, 0, 1);
  layers.sort((a, b) => b.depth - a.depth);

  const xs = bounds.map((b) => b.x);
  const ys = bounds.map((b) => b.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY) * 1.28;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + size * 0.04;
  return {
    viewBox: [cx - size / 2, cy - size / 2, size, size],
    layers,
    labels,
    unit: size * 0.012,
  };
}
