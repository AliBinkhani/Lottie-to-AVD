/**
 * Converts a stroked (and optionally trimmed) bezier path into filled outline
 * polygons, so a stroke can be used where only areas are allowed (clip-paths).
 *
 * The output always has the same number of contours and vertices for a given
 * path and options, whatever the trim values are. That lets the polygons be
 * animated with plain pathData interpolation between sampled frames.
 *
 * Every path vertex gets its own outline vertex with a miter offset (within
 * the miter limit), so sharp corners stay sharp. Round and bevel joins are
 * approximated by a single point at the stroke's half width.
 */
import { cubicPoint } from '../core/math.js';

const STEPS_PER_SEGMENT = 24;
const ROUND_CAP_POINTS = 7;

/** Flattens a bezier shape to points with cumulative arc lengths. */
function flatten(sh) {
  const v = sh.v, I = sh.i || [], O = sh.o || [], n = v.length;
  const add = (a, b) => [a[0] + (b ? b[0] : 0), a[1] + (b ? b[1] : 0)];
  const pts = [v[0].slice()];
  const segCount = sh.c ? n : n - 1;
  for (let j = 0; j < segCount; j++) {
    const a = v[j], b = v[(j + 1) % n];
    const P = [a, add(a, O[j]), add(b, I[(j + 1) % n]), b];
    for (let k = 1; k <= STEPS_PER_SEGMENT; k++) pts.push(cubicPoint(P, k / STEPS_PER_SEGMENT));
  }
  const len = [0];
  for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  // Arc length of every path vertex that can be a join (all of them on closed paths).
  const corners = [];
  for (let j = sh.c ? 0 : 1; j < (sh.c ? n : n - 1); j++) corners.push(len[j * STEPS_PER_SEGMENT]);
  return { pts, len, total: len[len.length - 1], corners };
}

/** Point and unit tangent at arc length d (clamped). */
function sampleAt(fl, d) {
  const { pts, len, total } = fl;
  d = Math.max(0, Math.min(total, d));
  let lo = 0, hi = len.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (len[m] <= d) lo = m; else hi = m;
  }
  // Skip zero-length steps when looking for a direction.
  let a = lo, b = hi;
  while (b < pts.length - 1 && len[b] - len[a] < 1e-9) b++;
  while (a > 0 && len[b] - len[a] < 1e-9) a--;
  const dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1];
  const dl = Math.hypot(dx, dy) || 1;
  const span = len[hi] - len[lo];
  const f = span > 0 ? (d - len[lo]) / span : 0;
  return {
    p: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f],
    t: [dx / dl, dy / dl],
  };
}

/** Offset direction and distance for a join at arc length d. */
function joinOffset(fl, closed, d, hw, join, miterLimit) {
  const eps = Math.max(1e-4, fl.total * 1e-5);
  const wrapD = x => (closed ? ((x % fl.total) + fl.total) % fl.total : x);
  const t1 = sampleAt(fl, wrapD(d - eps)).t, t2 = sampleAt(fl, wrapD(d + eps)).t;
  const n1 = [-t1[1], t1[0]], n2 = [-t2[1], t2[0]];
  const m = [n1[0] + n2[0], n1[1] + n2[1]];
  const ml = Math.hypot(m[0], m[1]);
  if (ml < 1e-6) return { n: n2, dist: hw };            // 180° turn
  const dir = [m[0] / ml, m[1] / ml];
  const miter = hw * 2 / ml;                              // hw / cos(θ/2)
  const dist = join === 'miter' && miter / hw <= miterLimit ? miter : hw;
  return { n: dir, dist };
}

/**
 * Outline of one stretch of the path, from arc length d0 over a length of
 * `span` (wrapping around for closed paths), as a polygon with a fixed vertex
 * count: `samples` evenly spaced points plus one point per path vertex.
 */
function band(fl, closed, d0, span, hw, o, samples) {
  const wrapD = d => (closed && fl.total > 0 ? ((d % fl.total) + fl.total) % fl.total : d);

  // Positions along the stretch (0..span): even samples + every corner, clamped.
  const pos = [];
  for (let k = 0; k < samples; k++) pos.push({ u: span * k / (samples - 1) });
  for (const cd of fl.corners) {
    let u = closed && fl.total > 0 ? (((cd - d0) % fl.total) + fl.total) % fl.total : cd - d0;
    const inside = u > 1e-6 && u < span - 1e-6;
    pos.push({ u: Math.max(0, Math.min(span, u)), corner: inside });
  }
  pos.sort((a, b) => a.u - b.u || (a.corner ? 1 : 0) - (b.corner ? 1 : 0));

  const left = [], right = [];
  let first = null, last = null;
  for (const q of pos) {
    const d = wrapD(d0 + q.u);
    const smp = sampleAt(fl, d);
    let n = [-smp.t[1], smp.t[0]], dist = hw;
    if (q.corner) ({ n, dist } = joinOffset(fl, closed, d, hw, o.join, o.miterLimit));
    left.push([smp.p[0] + n[0] * dist, smp.p[1] + n[1] * dist]);
    right.push([smp.p[0] - n[0] * dist, smp.p[1] - n[1] * dist]);
    if (!first) first = smp;
    last = smp;
  }
  const count = left.length;

  if (o.cap === 'square') {
    const ext = (pt, t, sign) => [pt[0] + sign * t[0] * hw, pt[1] + sign * t[1] * hw];
    left[0] = ext(left[0], first.t, -1); right[0] = ext(right[0], first.t, -1);
    left[count - 1] = ext(left[count - 1], last.t, 1); right[count - 1] = ext(right[count - 1], last.t, 1);
  }
  // Half circle around an end, from the `from` side, ROUND_CAP_POINTS inner points.
  const roundCap = (c, from) => {
    const out = [];
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    for (let k = 1; k <= ROUND_CAP_POINTS; k++) {
      const a = a0 - Math.PI * k / (ROUND_CAP_POINTS + 1);
      out.push([c[0] + Math.cos(a) * hw, c[1] + Math.sin(a) * hw]);
    }
    return out;
  };
  const poly = left.slice();
  if (o.cap === 'round') poly.push(...roundCap(last.p, left[count - 1]));
  for (let k = count - 1; k >= 0; k--) poly.push(right[k]);
  if (o.cap === 'round') poly.push(...roundCap(first.p, right[0]));
  return { v: poly, c: true, poly: true };
}

/** Number of samples along the path, based on its (static) vertex count. */
export function outlineSamples(sh) {
  const segs = sh && sh.v ? (sh.c ? sh.v.length : sh.v.length - 1) : 1;
  return Math.max(24, Math.min(160, segs * 12));
}

/**
 * @param sh       bezier shape { v, i, o, c }
 * @param opts     { width, cap: 'butt'|'round'|'square', join: 'miter'|'round'|'bevel',
 *                   miterLimit, trim: { s, e, o } | null
 *                   (fractions 0..1, offset in turns), samples, wrap: boolean }
 *                 `wrap` reserves a second contour for an open path whose trim
 *                 can wrap past its end (non-zero or animated offset).
 * @returns polygon contours [{ v, c: true, poly: true }]
 */
export function strokeOutline(sh, opts) {
  const hw = Math.max(0, opts.width || 0) / 2;
  const samples = opts.samples || outlineSamples(sh);
  const closed = !!sh.c;
  const fl = flatten(sh);
  const total = fl.total;
  const bo = { cap: opts.cap || 'butt', join: opts.join || 'miter', miterLimit: opts.miterLimit || 4 };

  let start = 0, span = total;
  if (opts.trim) {
    const s = Math.min(opts.trim.s, opts.trim.e), e = Math.max(opts.trim.s, opts.trim.e);
    let len = Math.max(0, Math.min(1, e) - Math.max(0, s));
    const off = ((s + (opts.trim.o || 0)) % 1 + 1) % 1;
    start = off * total;
    span = len * total;
  }

  if (closed || !opts.wrap) {
    if (!closed && start + span > total) span = Math.max(0, total - start);
    return [band(fl, closed, start, span, hw, bo, samples)];
  }
  // Open path that may wrap: two stretches, the second empty when unused.
  const firstSpan = Math.min(span, Math.max(0, total - start));
  const rest = Math.max(0, span - firstSpan);
  return [
    band(fl, false, start, firstSpan, hw, bo, samples),
    band(fl, false, 0, rest, hw, bo, samples),
  ];
}
