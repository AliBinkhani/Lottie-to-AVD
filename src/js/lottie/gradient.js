/**
 * Lottie gradient fills/strokes ('gf' / 'gs').
 *
 * Lottie stores gradient stops as one flat array:
 *   [offset, r, g, b] × colorCount, then optionally [offset, alpha] × n
 * Colour and opacity stops may sit at different offsets, so they are merged
 * into a single list of RGBA stops.
 */
import { clamp } from '../core/math.js';
import { isAnim, propAt } from './properties.js';

const lerp = (a, b, t) => a + (b - a) * t;

/** Linearly samples a sorted stop list [{ offset, value: number[] }] at `o`. */
function sampleStops(stops, o) {
  if (!stops.length) return null;
  if (o <= stops[0].offset) return stops[0].value;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (o <= b.offset) {
      const span = b.offset - a.offset;
      const t = span > 1e-9 ? (o - a.offset) / span : 1;
      return a.value.map((v, d) => lerp(v, b.value[d], t));
    }
  }
  return stops[stops.length - 1].value;
}

/** Splits Lottie's flat stop array into merged RGBA stops. */
export function parseStops(flat, colorCount) {
  flat = Array.isArray(flat) ? flat : [];
  const n = Math.max(0, colorCount | 0) || Math.floor(flat.length / 4);
  const colors = [];
  for (let i = 0; i < n && i * 4 + 3 < flat.length; i++) {
    const o = flat[i * 4];
    let rgb = flat.slice(i * 4 + 1, i * 4 + 4);
    if (rgb.some(v => v > 1)) rgb = rgb.map(v => v / 255);
    colors.push({ offset: clamp(o, 0, 1), value: rgb });
  }
  const alphas = [];
  for (let j = n * 4; j + 1 < flat.length; j += 2) {
    alphas.push({ offset: clamp(flat[j], 0, 1), value: [clamp(flat[j + 1], 0, 1)] });
  }
  if (!colors.length) return [];

  const offsets = [...new Set(colors.concat(alphas).map(s => +s.offset.toFixed(6)))].sort((a, b) => a - b);
  return offsets.map(o => {
    const rgb = sampleStops(colors, o);
    const a = alphas.length ? sampleStops(alphas, o)[0] : 1;
    return { offset: o, color: [rgb[0], rgb[1], rgb[2]], alpha: a };
  });
}

/** True if any part of the gradient changes over time. */
export function isGradientAnimated(style) {
  return [style.s, style.e, style.h, style.a, style.g && style.g.k].some(isAnim);
}

/** True if a radial gradient uses a highlight (focal point offset). */
export function hasHighlight(style) {
  if (style.t !== 2 || !style.h) return false;
  return isAnim(style.h) || Math.abs(propAt(style.h, 0, 'num')[0] || 0) > 1e-6;
}

/**
 * Evaluates a gradient at layer time t.
 * @returns {{ type: 'linear'|'radial', start: number[], end: number[], radius: number,
 *             stops: {offset:number, color:number[], alpha:number}[] }}
 */
export function gradientAt(style, t) {
  const start = style.s ? propAt(style.s, t, 'num') : [0, 0];
  const end = style.e ? propAt(style.e, t, 'num') : [0, 0];
  const flat = style.g && style.g.k ? propAt(style.g.k, t, 'num') : [];
  const stops = parseStops(flat, style.g && style.g.p);
  const type = style.t === 2 ? 'radial' : 'linear';
  const radius = Math.hypot(end[0] - start[0], end[1] - start[1]);
  return { type, start: [start[0] || 0, start[1] || 0], end: [end[0] || 0, end[1] || 0], radius, stops };
}

/** First colour of the gradient, used when gradients are disabled. */
export function firstGradientColor(style) {
  try {
    const g = gradientAt(style, 0);
    if (g.stops.length) return g.stops[0].color;
  } catch (e) { /* fall through */ }
  return [0.5, 0.5, 0.5];
}
