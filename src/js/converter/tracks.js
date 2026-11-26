/**
 * Tracks describe how one Android property changes over (composition) frames.
 *
 * A track has:
 *   type      : 'floatType' | 'colorType' | 'pathType'
 *   animated  : boolean
 *   at(f)     : value at composition frame f
 *   exact()   : keyframe segments that map 1:1 onto objectAnimators,
 *               [] when static, or null when the track must be sampled.
 *
 * A time map { a, b } converts layer-local time t to composition frames: f = a*t + b.
 */
import { isAnim, nv, getSegs, segEase, hasSpatial, propAt } from '../lottie/properties.js';

export const mapT = (m, t) => m.a * t + m.b;
export const unmap = (m, f) => (f - m.b) / m.a;

export function constTrack(v, type) {
  return { type: type || 'floatType', animated: false, at: () => v, exact: () => [] };
}

/** Track for dimension `d` of a numeric property, transformed by fn. */
export function numTrack(prop, map, d, kind, fn, def) {
  fn = fn || (v => v);
  if (!prop) return constTrack(fn(def || 0));
  kind = kind || 'num';
  return {
    type: 'floatType',
    animated: isAnim(prop),
    at(f) {
      const v = propAt(prop, unmap(map, f), kind);
      return fn(v[d] !== undefined ? v[d] : v[0]);
    },
    exact() {
      if (!isAnim(prop)) return [];
      const segs = getSegs(prop);
      if (kind === 'pos' && segs.some(hasSpatial)) return null;
      return segs.map(sg => {
        const a = nv(sg.v0, kind), b = nv(sg.v1, kind);
        const av = a[d] !== undefined ? a[d] : a[0];
        const bv = b[d] !== undefined ? b[d] : (b[0] !== undefined ? b[0] : av);
        return { f0: mapT(map, sg.t0), f1: mapT(map, sg.t1), v0: fn(av), v1: fn(bv), ease: segEase(sg, d).c, hold: sg.hold };
      });
    },
  };
}

/** Adds a constant k to a float track. */
export function offsetTrack(t, k) {
  if (!k) return t;
  return {
    type: t.type,
    animated: t.animated,
    at: f => t.at(f) + k,
    exact() {
      const e = t.exact();
      return e && e.map(s => Object.assign({}, s, { v0: s.v0 + k, v1: s.v1 + k }));
    },
  };
}

/**
 * Product of several float tracks (nested opacities, visibility).
 *
 * Exact when at most one factor changes smoothly and every other animated
 * factor only jumps (holds, e.g. layer in/out points), as long as no jump
 * falls inside one of the smooth factor's keyframe segments.
 */
export function prodTrack(tracks) {
  tracks = tracks.filter(Boolean);
  const anim = tracks.filter(t => t.animated);
  const at = f => tracks.reduce((m, t) => m * t.at(f), 1);
  return {
    type: 'floatType',
    animated: anim.length > 0,
    at,
    exact() {
      if (!anim.length) return [];
      const ex = anim.map(t => t.exact());
      if (ex.some(e => !e)) return null;
      const isJump = s => s.hold || s.f1 <= s.f0;
      const smoothIdx = ex.map((e, i) => (e.some(s => !isJump(s)) ? i : -1)).filter(i => i >= 0);
      if (smoothIdx.length > 1) return null;

      const jumps = [];
      ex.forEach((e, i) => { if (i !== smoothIdx[0]) e.forEach(s => jumps.push(s.f1)); });
      const smooth = smoothIdx.length ? ex[smoothIdx[0]] : [];
      const smoothTrack = smoothIdx.length ? anim[smoothIdx[0]] : null;
      if (jumps.some(h => smooth.some(s => !isJump(s) && h > s.f0 + 1e-6 && h < s.f1 - 1e-6))) return null;

      // Values just before / after a jump (wider than the visibility tolerance).
      const EPS = 1e-3;
      // Product of every factor except the smooth one.
      const others = f => tracks.reduce((m, t) => (t === smoothTrack ? m : m * t.at(f)), 1);
      const out = smooth.map(s => {
        if (isJump(s)) return Object.assign({}, s, { v0: s.v0 * others(s.f1 - EPS), v1: s.v1 * others(s.f1 + EPS) });
        const k = others((s.f0 + s.f1) / 2);
        return Object.assign({}, s, { v0: s.v0 * k, v1: s.v1 * k });
      });
      for (const h of [...new Set(jumps)]) {
        out.push({ f0: h, f1: h, v0: at(h - EPS), v1: at(h + EPS), hold: true });
      }
      return out.sort((a, b) => a.f0 - b.f0 || a.f1 - b.f1);
    },
  };
}

export function colorTrack(prop, map) {
  if (!prop) return constTrack([0, 0, 0], 'colorType');
  return {
    type: 'colorType',
    animated: isAnim(prop),
    at(f) {
      const v = propAt(prop, unmap(map, f), 'num');
      return [v[0], v[1], v[2]];
    },
    exact() {
      if (!isAnim(prop)) return [];
      return getSegs(prop).map(sg => ({
        f0: mapT(map, sg.t0), f1: mapT(map, sg.t1),
        v0: nv(sg.v0).slice(0, 3), v1: nv(sg.v1).slice(0, 3),
        ease: segEase(sg, 0).c, hold: sg.hold,
      }));
    },
  };
}
