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

/** Product of several float tracks (used for nested opacities). */
export function prodTrack(tracks) {
  tracks = tracks.filter(Boolean);
  const anim = tracks.filter(t => t.animated);
  return {
    type: 'floatType',
    animated: anim.length > 0,
    at: f => tracks.reduce((m, t) => m * t.at(f), 1),
    exact() {
      if (!anim.length) return [];
      if (anim.length > 1) return null;
      const ex = anim[0].exact();
      if (!ex) return null;
      const k = tracks.filter(t => !t.animated).reduce((m, t) => m * t.at(0), 1);
      return ex.map(s => Object.assign({}, s, { v0: s.v0 * k, v1: s.v1 * k }));
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
