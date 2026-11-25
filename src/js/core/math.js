/** Shared math helpers. */

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Circle approximation constant for cubic Béziers. */
export const KAPPA = 0.5522847498;

/**
 * Builds a CSS-style cubic-bezier easing function for control points
 * (x1, y1) and (x2, y2). Returns f(x) -> y on [0, 1].
 */
export function makeBezier(x1, y1, x2, y2) {
  if (Math.abs(x1 - y1) < 1e-9 && Math.abs(x2 - y2) < 1e-9) return t => t;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t;
  const Y = t => ((ay * t + by) * t + cy) * t;
  const DX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    // Newton-Raphson first, then bisection as a fallback.
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-7) return Y(t);
      const d = DX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 50; i++) {
      const v = X(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

/** Point on a cubic Bézier defined by 4 points at parameter u. */
export function cubicPoint(P, u) {
  const m = 1 - u, a = m * m * m, b = 3 * m * m * u, c = 3 * m * u * u, d = u * u * u;
  return [
    a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0],
    a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1],
  ];
}
