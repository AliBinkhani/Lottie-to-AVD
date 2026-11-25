/**
 * Evaluation of (possibly animated) Lottie properties.
 *
 * `kind` selects how values are normalised:
 *   - 'num'   : number or number[] (returned as an array)
 *   - 'pos'   : like 'num', but honours spatial tangents (to/ti)
 *   - 'shape' : a bezier shape { v, i, o, c }
 */
import { clamp, makeBezier, cubicPoint } from '../core/math.js';

export function isAnim(p) {
  return !!(p && Array.isArray(p.k) && p.k.length > 0 && p.k[0] &&
    typeof p.k[0] === 'object' && !Array.isArray(p.k[0]) && 't' in p.k[0]);
}

export function nv(v, kind) {
  if (kind === 'shape') return Array.isArray(v) ? v[0] : v;
  return Array.isArray(v) ? v : [v];
}

function pick(v, d) {
  return Array.isArray(v) ? (v[d] !== undefined ? v[d] : v[0]) : v;
}

function easeControls(kf, d) {
  const x1 = pick(kf.o && kf.o.x, d), y1 = pick(kf.o && kf.o.y, d);
  const x2 = pick(kf.i && kf.i.x, d), y2 = pick(kf.i && kf.i.y, d);
  if ([x1, y1, x2, y2].some(v => typeof v !== 'number' || !isFinite(v))) return { x1: 0, y1: 0, x2: 1, y2: 1 };
  return { x1: clamp(x1, 0, 1), y1, x2: clamp(x2, 0, 1), y2 };
}

const segCache = new WeakMap();

/** Splits a property's keyframes into segments { t0, t1, v0, v1, kf, hold }. */
export function getSegs(prop) {
  let s = segCache.get(prop);
  if (s) return s;
  const k = prop.k;
  s = [];
  let prev = null;
  for (let i = 0; i < k.length; i++) {
    const kf = k[i], nx = k[i + 1];
    const v0 = kf.s !== undefined ? kf.s : prev;
    if (!nx) { s.last = v0 != null ? v0 : prev; break; }
    const v1 = kf.e !== undefined ? kf.e : (nx.s !== undefined ? nx.s : v0);
    s.push({ t0: kf.t, t1: nx.t, v0, v1, kf, hold: kf.h === 1 || kf.h === true, ease: [] });
    prev = v1;
  }
  if (s.last == null) s.last = prev != null ? prev : k[0].s;
  segCache.set(prop, s);
  return s;
}

/** Easing ({ c: controls, fn }) of a segment for dimension d. */
export function segEase(sg, d) {
  if (!sg.ease[d]) {
    const c = easeControls(sg.kf, d);
    sg.ease[d] = { c, fn: makeBezier(c.x1, c.y1, c.x2, c.y2) };
  }
  return sg.ease[d];
}

export function hasSpatial(sg) {
  const nz = a => Array.isArray(a) && a.some(v => Math.abs(v) > 1e-6);
  return nz(sg.kf.to) || nz(sg.kf.ti);
}

/** Position along a spatial (curved) motion path, parametrised by arc length. */
function spatialPoint(sg, a, b, e) {
  if (!sg.arc) {
    const to = sg.kf.to || [0, 0], ti = sg.kf.ti || [0, 0];
    const P = [a, [a[0] + to[0], a[1] + to[1]], [b[0] + ti[0], b[1] + ti[1]], b];
    const N = 80, pts = [], len = [0];
    for (let i = 0; i <= N; i++) {
      pts.push(cubicPoint(P, i / N));
      if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    sg.arc = { pts, len, total: len[N] };
  }
  const { pts, len, total } = sg.arc;
  if (total < 1e-9) return [a[0], a[1]];
  const target = clamp(e, 0, 1) * total;
  let lo = 0, hi = len.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (len[m] <= target) lo = m; else hi = m;
  }
  const span = len[hi] - len[lo], f = span > 0 ? (target - len[lo]) / span : 0;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

function lerpShape(a, b, e) {
  if (!a || !b || !a.v || !b.v || a.v.length !== b.v.length) return e < 1 ? a : b;
  const zeros = s => s.v.map(() => [0, 0]);
  const L = (A, B) => A.map((p, i) => [p[0] + ((B[i] || p)[0] - p[0]) * e, p[1] + ((B[i] || p)[1] - p[1]) * e]);
  return { v: L(a.v, b.v), i: L(a.i || zeros(a), b.i || zeros(b)), o: L(a.o || zeros(a), b.o || zeros(b)), c: a.c };
}

function interpSeg(sg, p, kind) {
  const a = nv(sg.v0, kind), b = nv(sg.v1, kind);
  if (kind === 'shape') return lerpShape(a, b, segEase(sg, 0).fn(p));
  if (kind === 'pos' && hasSpatial(sg)) return spatialPoint(sg, a, b, segEase(sg, 0).fn(p));
  const out = [];
  for (let d = 0; d < a.length; d++) {
    const e = segEase(sg, d).fn(p);
    const bd = b[d] !== undefined ? b[d] : a[d];
    out.push(a[d] + (bd - a[d]) * e);
  }
  return out;
}

/** Value of a Lottie property at (layer-local) time t. */
export function propAt(prop, t, kind) {
  if (!isAnim(prop)) return nv(prop.k, kind);
  const segs = getSegs(prop);
  if (!segs.length) return nv(segs.last, kind);
  if (t <= segs[0].t0) return nv(segs[0].v0, kind);
  for (const sg of segs) {
    if (t < sg.t1) {
      if (t < sg.t0 || sg.hold || sg.t1 <= sg.t0) return nv(sg.v0, kind);
      return interpSeg(sg, (t - sg.t0) / (sg.t1 - sg.t0), kind);
    }
  }
  return nv(segs.last, kind);
}
