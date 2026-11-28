/**
 * 2D affine transforms for Lottie layers and shape groups, used when shapes
 * must be expressed in another coordinate space (e.g. track-matte clip paths).
 *
 * A matrix is [a, b, c, d, e, f]:  x' = a*x + c*y + e,  y' = b*x + d*y + f
 */
import { isAnim, propAt } from './properties.js';

export const IDENTITY = [1, 0, 0, 1, 0, 0];

/** m1 · m2 (apply m2 first, then m1). */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

export function apply(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** translate(p) · rotate(r) · scale(s) · translate(-a) — the Lottie / Android order. */
function compose(px, py, rotDeg, sx, sy, ax, ay) {
  const r = rotDeg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  return [a, b, c, d, px - (a * ax + c * ay), py - (b * ax + d * ay)];
}

const val = (p, t, def) => (p ? propAt(p, t, 'num') : def);

/** Matrix of a layer transform (ks) or shape-group transform (tr) at layer time t. */
export function transformMatrix(ks, t) {
  if (!ks) return IDENTITY;
  let px, py;
  const pos = ks.p;
  if (pos && pos.s && (pos.x || pos.y)) {
    px = val(pos.x, t, [0])[0] || 0;
    py = val(pos.y, t, [0])[0] || 0;
  } else if (pos) {
    const p = propAt(pos, t, 'pos');
    px = p[0] || 0; py = p[1] || 0;
  } else { px = 0; py = 0; }
  const a = val(ks.a, t, [0, 0]);
  const s = val(ks.s, t, [100, 100]);
  const r = val(ks.r || ks.rz, t, [0])[0] || 0;
  const sx = (s[0] != null ? s[0] : 100) / 100, sy = (s[1] != null ? s[1] : s[0] != null ? s[0] : 100) / 100;
  return compose(px, py, r, sx, sy, a[0] || 0, a[1] || 0);
}

/** True if any part of a transform changes over time. */
export function isTransformAnimated(ks) {
  if (!ks) return false;
  const pos = ks.p;
  const posAnim = pos && pos.s && (pos.x || pos.y) ? (isAnim(pos.x) || isAnim(pos.y)) : isAnim(pos);
  return posAnim || isAnim(ks.a) || isAnim(ks.s) || isAnim(ks.r) || isAnim(ks.rz);
}

/** Transforms a bezier shape { v, i, o, c } (tangents relative to vertices). */
export function transformShape(sh, m) {
  const v = sh.v.map(p => apply(m, p));
  const rel = (tans) => (tans || sh.v.map(() => [0, 0])).map((d, k) => {
    const abs = apply(m, [sh.v[k][0] + d[0], sh.v[k][1] + d[1]]);
    return [abs[0] - v[k][0], abs[1] - v[k][1]];
  });
  return { v, i: rel(sh.i), o: rel(sh.o), c: sh.c };
}

/** Shoelace area of a shape's vertices (positive = clockwise on a y-down canvas). */
export function signedArea(sh) {
  const v = sh.v;
  let s = 0;
  for (let k = 0; k < v.length; k++) {
    const p = v[k], q = v[(k + 1) % v.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Same outline, opposite direction. */
export function reverseShape(sh) {
  const n = sh.v.length;
  const idx = [...Array(n).keys()].reverse();
  const zeros = sh.v.map(() => [0, 0]);
  return {
    v: idx.map(k => sh.v[k]),
    i: idx.map(k => (sh.o || zeros)[k]),
    o: idx.map(k => (sh.i || zeros)[k]),
    c: sh.c,
  };
}

/** Returns the shape oriented clockwise (positive area) or counter-clockwise. */
export function orient(sh, clockwise = true) {
  const a = signedArea(sh);
  return (a >= 0) === clockwise ? sh : reverseShape(sh);
}
