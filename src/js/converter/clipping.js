/**
 * Track mattes and masks -> <clip-path> tracks.
 *
 * An AVD <clip-path> clips everything drawn after it in its <group>, and
 * several clip-paths intersect. It is a hard-edged area, so soft mattes
 * (partial opacity, luma, feathering) can only be approximated.
 *
 * Inverted clips are made by putting the shape inside a huge rectangle of the
 * opposite winding direction: with the non-zero rule the shape becomes a hole.
 */
import { isAnim, propAt } from '../lottie/properties.js';
import { shapeToD, geomShape } from '../lottie/geometry.js';
import { IDENTITY, multiply, transformMatrix, isTransformAnimated, transformShape, orient } from '../lottie/transform.js';
import { unmap, constTrack } from './tracks.js';

const GEOM = { sh: 1, rc: 1, el: 1, sr: 1 };
const FILLS = { fl: 1, gf: 1 };
const STROKES = { st: 1, gs: 1 };

/** Bezier shape for an axis-aligned rectangle. */
function rectShape(L, T, R, B) {
  const z = () => [[0, 0], [0, 0], [0, 0], [0, 0]];
  return { v: [[L, T], [R, T], [R, B], [L, B]], i: z(), o: z(), c: true };
}

/** Builds a pathType track from a function returning contours at frame f. */
function pathTrack(contoursAt, animated, { inverted, bound }) {
  const outer = inverted ? orient(rectShape(-bound, -bound, bound, bound), false) : null;
  const toD = shapes => {
    const parts = shapes.filter(s => s && s.v && s.v.length).map(s => shapeToD(inverted ? orient(s, true) : s));
    if (outer) parts.unshift(shapeToD(outer));
    return parts.length ? parts.join(' ') : 'M0,0';
  };
  if (!animated) return constTrack(toD(contoursAt(null)), 'pathType');
  return { type: 'pathType', animated: true, at: f => toD(contoursAt(f)), exact: () => null };
}

const isOpaque = p => !p || (!isAnim(p) && Math.abs((propAt(p, 0, 'num')[0] ?? 100) - 100) < 1e-6);

/**
 * Collects the geometry painted by fills in a list of shape items, together
 * with the shape-group transforms above each geometry.
 */
function collectFilled(items, trs, out, flags, seen) {
  const list = (items || []).filter(it => it && !it.hd && it.ty !== 'tr');
  const gather = (lst, upto, chain) => {
    for (let j = 0; j < upto; j++) {
      const it = lst[j];
      if (GEOM[it.ty]) {
        if (!seen.has(it)) { seen.add(it); out.push({ geom: it, trs: chain }); }
      } else if (it.ty === 'gr') {
        const sub = (it.it || []).filter(x => x && !x.hd && x.ty !== 'tr');
        gather(sub, sub.length, chain.concat([(it.it || []).find(x => x && x.ty === 'tr')]));
      }
    }
  };
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (FILLS[it.ty]) {
      gather(list, i, trs);
      if (it.ty === 'gf' || !isOpaque(it.o)) flags.soft = true;
    } else if (STROKES[it.ty]) {
      flags.stroke = true;
    } else if (it.ty === 'gr') {
      const tr = (it.it || []).find(x => x && x.ty === 'tr');
      if (tr && !isOpaque(tr.o)) flags.soft = true;
      collectFilled(it.it, trs.concat([tr]), out, flags, seen);
    } else if (it.ty === 'tm') {
      flags.trim = true;
    }
  }
}

/**
 * Clip track for a track matte.
 *
 * @param matte      the matte layer (td = 1)
 * @param restChain  the matte's own layer + parents that the matted layer does
 *                   NOT share, outermost first; the clip lives in the space of
 *                   the shared ancestors
 * @param mapOf      layer -> time map
 * @returns {{ track, flags } | { unsupported: string }}
 */
export function matteClip({ matte, restChain, mapOf, inverted, bound }) {
  const flags = {};
  let pieces = [];

  if (matte.ty === 4) {
    collectFilled(matte.shapes, [], pieces, flags, new Set());
  } else if (matte.ty === 1) {
    const sw = matte.sw || 0, sh = matte.sh || 0;
    pieces = [{ rect: rectShape(0, 0, sw, sh), trs: [] }];
  } else {
    return { unsupported: 'type' };
  }
  if (!pieces.length) return { unsupported: flags.stroke ? 'stroke' : 'empty' };
  if (matte.ks && !isOpaque(matte.ks.o)) flags.soft = true;

  const animated =
    restChain.some(c => isTransformAnimated(c.ks)) ||
    pieces.some(p => p.trs.some(tr => isTransformAnimated(tr)) ||
      (p.geom && [p.geom.ks, p.geom.p, p.geom.s, p.geom.r, p.geom.or, p.geom.ir, p.geom.pt].some(isAnim)));

  const contoursAt = f => {
    // f === null: static clip, any time will do.
    const frameOf = c => (f == null ? 0 : unmap(mapOf(c), f));
    let m = IDENTITY;
    for (const c of restChain) m = multiply(m, transformMatrix(c.ks, frameOf(c)));
    const t = frameOf(matte);
    return pieces.map(p => {
      const sh = p.rect || geomShape(p.geom, t);
      if (!sh || !sh.v) return null;
      let mp = m;
      for (const tr of p.trs) mp = multiply(mp, transformMatrix(tr, t));
      return orient(transformShape(sh, mp), true);
    });
  };
  return { track: pathTrack(contoursAt, animated, { inverted, bound }), flags };
}

/**
 * Clip tracks for a layer's masks, in layer space. Each returned track is one
 * <clip-path>; several of them intersect.
 *
 * Exact for: a run of Add masks first (union), followed by Subtract and
 * Intersect masks. Other combinations are approximated and reported.
 */
export function maskClips(masks, map, { bound, warn }) {
  const active = (masks || []).filter(m => m && m.mode !== 'n' && m.pt);
  if (!active.length) return [];
  if (active.some(m => !isOpaque(m.o) || (m.x && (isAnim(m.x) || Math.abs(propAt(m.x, 0, 'num')[0] || 0) > 1e-6)))) {
    warn('maskSoft');
  }

  const groups = []; // { masks: [...], inverted }
  let i = 0;
  if (active[0].mode === 'a' || active[0].mode === undefined) {
    const run = [];
    while (i < active.length && (active[i].mode === 'a' || active[i].mode === undefined)) run.push(active[i++]);
    const inv = run.length === 1 ? !!run[0].inv : false;
    if (run.length > 1 && run.some(m => m.inv)) warn('maskMode');
    groups.push({ masks: run, inverted: inv });
  }
  for (; i < active.length; i++) {
    const m = active[i];
    if (m.mode === 's') groups.push({ masks: [m], inverted: !m.inv });
    else if (m.mode === 'i') groups.push({ masks: [m], inverted: !!m.inv });
    else warn('maskMode'); // Add after Subtract/Intersect, Lighten, Darken, Difference
  }

  return groups.map(g => {
    const animated = g.masks.some(m => isAnim(m.pt));
    const contoursAt = f => {
      const t = f == null ? 0 : unmap(map, f);
      return g.masks.map(m => {
        const sh = propAt(m.pt, t, 'shape');
        return sh && sh.v ? (g.masks.length > 1 ? orient(sh, true) : sh) : null;
      });
    };
    return pathTrack(contoursAt, animated, { inverted: g.inverted, bound });
  });
}

