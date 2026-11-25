/** Number / color formatting used when writing Android XML. */
import { clamp } from './math.js';

let precision = 3;

/** Sets the number of decimal places used by fmt(). */
export function setPrecision(p) {
  precision = clamp(Math.round(+p || 3), 0, 6);
}

export function getPrecision() {
  return precision;
}

/** Formats a number with the current precision, without trailing zeros. */
export function fmt(n) {
  if (!isFinite(n)) n = 0;
  let r = +(+n).toFixed(precision);
  if (r === 0) r = 0; // drop "-0"
  return String(r);
}

/** Converts a Lottie color ([r,g,b] in 0..1 or 0..255) to #RRGGBB. */
export function colorHex(c) {
  let [r, g, b] = c;
  if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
  const h = v => Math.round(clamp(v || 0, 0, 1) * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(r) + h(g) + h(b);
}

/** Formats a value according to its Android valueType. */
export function fmtVal(type, v) {
  if (type === 'colorType') return colorHex(v);
  if (type === 'pathType') return v;
  return fmt(v);
}
