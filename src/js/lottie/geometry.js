/** Builds Android/SVG path data from Lottie shape items. */
import { clamp, KAPPA } from '../core/math.js';
import { fmt } from '../core/format.js';
import { propAt } from './properties.js';

const P = p => fmt(p[0]) + ',' + fmt(p[1]);

/** Path data for a Lottie bezier shape { v, i, o, c }. */
export function shapeToD(sh) {
  if (!sh || !sh.v || !sh.v.length) return 'M0,0';
  const v = sh.v, I = sh.i || [], O = sh.o || [], n = v.length;
  const add = (a, b) => [a[0] + (b ? b[0] : 0), a[1] + (b ? b[1] : 0)];
  let d = 'M' + P(v[0]);
  for (let j = 1; j < n; j++) d += ' C' + P(add(v[j - 1], O[j - 1])) + ' ' + P(add(v[j], I[j])) + ' ' + P(v[j]);
  if (sh.c) d += ' C' + P(add(v[n - 1], O[n - 1])) + ' ' + P(add(v[0], I[0])) + ' ' + P(v[0]) + ' Z';
  return d;
}

function ellipse(item, g) {
  const p = g(item.p, [0, 0]), s = g(item.s, [0, 0]);
  const cx = p[0], cy = p[1], rx = s[0] / 2, ry = (s[1] !== undefined ? s[1] : s[0]) / 2;
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return 'M' + P([cx, cy - ry]) +
    ' C' + P([cx + kx, cy - ry]) + ' ' + P([cx + rx, cy - ky]) + ' ' + P([cx + rx, cy]) +
    ' C' + P([cx + rx, cy + ky]) + ' ' + P([cx + kx, cy + ry]) + ' ' + P([cx, cy + ry]) +
    ' C' + P([cx - kx, cy + ry]) + ' ' + P([cx - rx, cy + ky]) + ' ' + P([cx - rx, cy]) +
    ' C' + P([cx - rx, cy - ky]) + ' ' + P([cx - kx, cy - ry]) + ' ' + P([cx, cy - ry]) + ' Z';
}

function rect(item, g) {
  const p = g(item.p, [0, 0]), s = g(item.s, [0, 0]);
  const w = s[0], h = s[1] !== undefined ? s[1] : s[0];
  const r = clamp(g(item.r, [0])[0] || 0, 0, Math.min(Math.abs(w), Math.abs(h)) / 2);
  const L = p[0] - w / 2, R = p[0] + w / 2, T = p[1] - h / 2, B = p[1] + h / 2;
  const corner = (A, C, Bp) => ' C' +
    P([A[0] + (C[0] - A[0]) * KAPPA, A[1] + (C[1] - A[1]) * KAPPA]) + ' ' +
    P([Bp[0] + (C[0] - Bp[0]) * KAPPA, Bp[1] + (C[1] - Bp[1]) * KAPPA]) + ' ' + P(Bp);
  return 'M' + P([R, T + r]) + ' L' + P([R, B - r]) + corner([R, B - r], [R, B], [R - r, B]) +
    ' L' + P([L + r, B]) + corner([L + r, B], [L, B], [L, B - r]) +
    ' L' + P([L, T + r]) + corner([L, T + r], [L, T], [L + r, T]) +
    ' L' + P([R - r, T]) + corner([R - r, T], [R, T], [R, T + r]) + ' Z';
}

function star(item, g) {
  const p = g(item.p, [0, 0]);
  const pts = Math.max(3, Math.round(g(item.pt, [5])[0]));
  const or = g(item.or, [10])[0], ir = g(item.ir, [5])[0], rot = g(item.r, [0])[0];
  const isStar = item.sy !== 2, n = isStar ? pts * 2 : pts;
  const step = 2 * Math.PI / n, a0 = (rot - 90) * Math.PI / 180;
  let d = '';
  for (let i = 0; i < n; i++) {
    const r = isStar && i % 2 ? ir : or;
    const pt = [p[0] + r * Math.cos(a0 + i * step), p[1] + r * Math.sin(a0 + i * step)];
    d += (i ? ' L' : 'M') + P(pt);
  }
  return d + ' Z';
}

/** Path data for a parametric shape (el / rc / sr) at layer time t. */
export function geomD(item, t) {
  const g = (p, def) => (p ? propAt(p, t, 'num') : def);
  if (item.ty === 'el') return ellipse(item, g);
  if (item.ty === 'rc') return rect(item, g);
  if (item.ty === 'sr') return star(item, g);
  return 'M0,0';
}
