/**
 * Lottie JSON -> AnimatedVectorDrawable XML.
 *
 * Pipeline:
 *   1. Walk the Lottie layer tree and build a scene of <group>/<path> nodes
 *      whose properties are Tracks (see tracks.js).
 *   2. Compile every track into objectAnimator segments: exact keyframes when
 *      possible, otherwise sampled and simplified to linear keyframes.
 *   3. Serialise the result as XML (see xml-writer.js).
 *
 * Warnings are returned as language-neutral keys ({ key, count, params });
 * the UI translates them.
 */
import { fmt, fmtVal, setPrecision, getPrecision } from '../core/format.js';
import { isAnim, nv, getSegs, segEase, propAt } from '../lottie/properties.js';
import { shapeToD, geomD } from '../lottie/geometry.js';
import { gradientAt, isGradientAnimated, hasHighlight, firstGradientColor } from '../lottie/gradient.js';
import { mapT, unmap, constTrack, numTrack, offsetTrack, prodTrack, colorTrack } from './tracks.js';
import { writeXml } from './xml-writer.js';
import { matteClip, maskClips } from './clipping.js';

/** Error with a translatable code. */
export class ConversionError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail;
  }
}

/** Returns true if the object looks like a Lottie animation. */
export function isLottie(json) {
  return !!(json && typeof json === 'object' && Array.isArray(json.layers) && json.w && json.h);
}

function sanitize(s) {
  s = String(s || '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[A-Za-z]/.test(s)) s = 'n' + s;
  return s.slice(0, 32);
}

function hasExpressions(o, depth) {
  if (!o || typeof o !== 'object' || depth > 60) return false;
  if (typeof o.x === 'string' && 'k' in o) return true;
  for (const k in o) {
    if (o[k] && typeof o[k] === 'object' && hasExpressions(o[k], depth + 1)) return true;
  }
  return false;
}

const GEOM = { sh: 1, rc: 1, el: 1, sr: 1 };

/** Default attribute values that can be omitted from the XML. */
const DEFAULTS = {
  pivotX: '0', pivotY: '0', rotation: '0', scaleX: '1', scaleY: '1', translateX: '0', translateY: '0',
  fillAlpha: '1', strokeAlpha: '1', trimPathStart: '0', trimPathEnd: '1', trimPathOffset: '0',
};

/**
 * @param {object} json  Lottie animation
 * @param {{dp?:number, step?:number, precision?:number, gradients?:boolean}} opts
 *   gradients: emit real <gradient>s (needs API 24+); otherwise use the first colour
 */
export function convert(json, opts = {}) {
  if (!isLottie(json)) throw new ConversionError('invalidLottie');
  if (opts.precision != null) setPrecision(opts.precision);

  const W = json.w, H = json.h, fr = json.fr || 30, ip = json.ip || 0;
  const op = json.op != null ? json.op : ip + fr;
  const step = Math.max(1, opts.step || 1);
  const gradients = opts.gradients !== false;

  const warns = new Map();
  const warn = (key, params) => {
    const w = warns.get(key) || { key, count: 0, params };
    w.count++;
    warns.set(key, w);
  };

  let counter = 0;
  const uname = b => sanitize(b) + '_' + (++counter);
  const assets = {};
  (json.assets || []).forEach(a => { if (a && a.id) assets[a.id] = a; });
  if (hasExpressions(json, 0)) warn('expr');

  const node = (tag, name) => ({ tag, name, stat: {}, tracks: {}, children: [] });
  const root = node('root', 'root');

  /* ---------- scene building ---------- */

  /**
   * Time map for the layers *inside* a precomp layer L. A layer's own keyframes
   * (transform, shapes, masks) are in its composition's time, like lottie-web;
   * start time (st) and stretch (sr) only shift the precomp's inner timeline.
   */
  function innerCompMap(compMap, L) {
    const sr = L.sr || 1, st = L.st || 0;
    return { a: compMap.a * sr, b: compMap.a * st + compMap.b };
  }

  /** 0/1 track for a layer's in/out points. */
  function visTrack(L, compMap) {
    const cS = unmap(compMap, ip), cE = unmap(compMap, op);
    const lip = L.ip != null ? L.ip : -Infinity, lop = L.op != null ? L.op : Infinity;
    if (lip <= cS + 1e-6 && lop >= cE - 1e-6) return constTrack(1);
    if (lop <= cS + 1e-6 || lip >= cE - 1e-6) return constTrack(0);
    return {
      type: 'floatType', animated: true,
      at(f) { const c = unmap(compMap, f); return (c >= lip - 1e-6 && c < lop - 1e-6) ? 1 : 0; },
      exact() {
        const segs = [], fIn = mapT(compMap, lip), fOut = mapT(compMap, lop);
        if (fIn > ip + 1e-6) segs.push({ f0: fIn, f1: fIn, v0: 0, v1: 1, hold: true });
        if (fOut < op - 1e-6) segs.push({ f0: fOut, f1: fOut, v0: 1, v1: 0, hold: true });
        return segs;
      },
    };
  }

  /** Adds a <group> for a Lottie transform and returns the node children go into. */
  function addTransform(host, ks, map, label) {
    ks = ks || {};
    const pos = ks.p, anc = ks.a, sc = ks.s, rot = ks.r || ks.rz;
    if (ks.sk && (isAnim(ks.sk) || Math.abs(propAt(ks.sk, 0, 'num')[0] || 0) > 1e-6)) warn('skew');
    const nonzero = p => p && (isAnim(p) || Math.abs(propAt(p, 0, 'num')[0] || 0) > 1e-6);
    if (nonzero(ks.rx) || nonzero(ks.ry)) warn('d3');

    let tx, ty;
    if (pos && pos.s && (pos.x || pos.y)) { tx = numTrack(pos.x, map, 0, 'num'); ty = numTrack(pos.y, map, 0, 'num'); }
    else if (pos) { tx = numTrack(pos, map, 0, 'pos'); ty = numTrack(pos, map, 1, 'pos'); }
    else { tx = constTrack(0); ty = constTrack(0); }
    const sx = numTrack(sc, map, 0, 'num', v => v / 100, 100);
    const sy = numTrack(sc, map, 1, 'num', v => v / 100, 100);
    const r = numTrack(rot, map, 0, 'num');

    const g = node('group', uname(label));
    host.children.push(g);
    g.tracks.rotation = r; g.tracks.scaleX = sx; g.tracks.scaleY = sy;

    if (!anc || !isAnim(anc)) {
      const a0 = anc ? propAt(anc, 0, 'num') : [0, 0];
      const ax = a0[0] || 0, ay = a0[1] || 0;
      g.stat.pivotX = ax; g.stat.pivotY = ay;
      g.tracks.translateX = offsetTrack(tx, -ax);
      g.tracks.translateY = offsetTrack(ty, -ay);
      return g;
    }
    // Animated anchor point: needs a second, inner group.
    g.tracks.translateX = tx; g.tracks.translateY = ty;
    const inner = node('group', uname(label + '_anchor'));
    g.children.push(inner);
    inner.tracks.translateX = numTrack(anc, map, 0, 'num', v => -v);
    inner.tracks.translateY = numTrack(anc, map, 1, 'num', v => -v);
    return inner;
  }

  function geomTrack(item, map) {
    if (item.ty === 'sh') {
      const prop = item.ks;
      if (!prop) return constTrack('M0,0', 'pathType');
      let animated = isAnim(prop);
      if (animated) {
        const counts = new Set();
        getSegs(prop).forEach(s => {
          const a = nv(s.v0, 'shape'), b = nv(s.v1, 'shape');
          if (a && a.v) counts.add(a.v.length + (a.c ? 'c' : 'o'));
          if (b && b.v) counts.add(b.v.length + (b.c ? 'c' : 'o'));
        });
        if (counts.size > 1) { warn('morph'); animated = false; }
      }
      const t0 = unmap(map, ip);
      if (!animated) return constTrack(shapeToD(propAt(prop, t0, 'shape')), 'pathType');
      return {
        type: 'pathType', animated: true,
        at: f => shapeToD(propAt(prop, unmap(map, f), 'shape')),
        exact: () => getSegs(prop).map(sg => ({
          f0: mapT(map, sg.t0), f1: mapT(map, sg.t1),
          v0: shapeToD(nv(sg.v0, 'shape')), v1: shapeToD(nv(sg.v1, 'shape')),
          ease: segEase(sg, 0).c, hold: sg.hold,
        })),
      };
    }
    if (item.ty === 'sr') {
      const roundness = p => p && (isAnim(p) || propAt(p, 0, 'num')[0]);
      if (roundness(item.is) || roundness(item.os)) warn('starRound');
      if (isAnim(item.pt)) warn('morph');
    }
    const props = [item.p, item.s, item.r, item.or, item.ir].filter(Boolean);
    if (!props.some(isAnim)) return constTrack(geomD(item, unmap(map, ip)), 'pathType');
    return { type: 'pathType', animated: true, at: f => geomD(item, unmap(map, f)), exact: () => null };
  }

  /** Collects geometry items that a style at index `upto` applies to. */
  function collectGeoms(list, upto, chain, out) {
    for (let j = 0; j < upto; j++) {
      const it = list[j];
      if (GEOM[it.ty]) {
        out.push({ geom: it, chain: chain.slice(), trims: list.slice(j + 1, upto).filter(x => x.ty === 'tm') });
      } else if (it.ty === 'gr') {
        const sub = (it.it || []).filter(x => x && !x.hd && x.ty !== 'tr');
        const tr = (it.it || []).find(x => x && x.ty === 'tr');
        const start = out.length;
        collectGeoms(sub, sub.length, chain.concat([{ tr, nm: it.nm }]), out);
        const outer = list.slice(j + 1, upto).filter(x => x.ty === 'tm');
        for (let q = start; q < out.length; q++) out[q].trims = out[q].trims.concat(outer);
      }
    }
  }

  function emitPath(host, style, g, ctx) {
    let h = host;
    for (const c of g.chain) h = addTransform(h, c.tr, ctx.map, c.nm || 'group');
    const p = node('path', uname(style.nm || g.geom.nm || 'path'));
    h.children.push(p);
    p.tracks.pathData = geomTrack(g.geom, ctx.map);
    const alpha = prodTrack(ctx.alpha.concat([numTrack(style.o, ctx.map, 0, 'num', v => v / 100, 100)]));
    const isFill = style.ty === 'fl' || style.ty === 'gf';
    const isGradient = style.ty === 'gf' || style.ty === 'gs';
    const colorAttr = isFill ? 'fillColor' : 'strokeColor';

    if (isGradient && gradients) {
      // Static gradient (API 24+). Animated gradients use their first frame.
      if (isGradientAnimated(style)) warn('gradientAnim');
      if (hasHighlight(style)) warn('gradientHighlight');
      const spec = gradientAt(style, unmap(ctx.map, ip));
      if (spec.stops.length) p.gradient = { attr: colorAttr, spec };
      else p.tracks[colorAttr] = constTrack([0.5, 0.5, 0.5], 'colorType');
    } else if (isGradient) {
      warn('gradient');
      p.tracks[colorAttr] = constTrack(firstGradientColor(style), 'colorType');
    } else {
      p.tracks[colorAttr] = colorTrack(style.c, ctx.map);
    }

    if (isFill) {
      p.tracks.fillAlpha = alpha;
      if (style.r === 2) p.stat.fillType = 'evenOdd';
    } else {
      p.tracks.strokeAlpha = alpha;
      p.tracks.strokeWidth = numTrack(style.w, ctx.map, 0, 'num', null, 1);
      p.stat.strokeLineCap = ({ 1: 'butt', 2: 'round', 3: 'square' })[style.lc] || 'butt';
      p.stat.strokeLineJoin = ({ 1: 'miter', 2: 'round', 3: 'bevel' })[style.lj] || 'miter';
      if (p.stat.strokeLineJoin === 'miter') p.stat.strokeMiterLimit = style.ml != null ? style.ml : 4;
      if (Array.isArray(style.d) && style.d.length) warn('dash');
    }

    if (g.trims.length) {
      const tm = g.trims[0];
      if (g.trims.length > 1) warn('multitrim');
      if (tm.m === 1 && ctx.geomCount > 1) warn('trimSim');
      p.tracks.trimPathStart = numTrack(tm.s, ctx.map, 0, 'num', v => v / 100, 0);
      p.tracks.trimPathEnd = numTrack(tm.e, ctx.map, 0, 'num', v => v / 100, 100);
      p.tracks.trimPathOffset = numTrack(tm.o, ctx.map, 0, 'num', v => v / 360, 0);
    }
  }

  function renderShapes(items, host, ctx) {
    const list = (items || []).filter(it => it && !it.hd && it.ty !== 'tr');
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.ty === 'fl' || it.ty === 'st' || it.ty === 'gf' || it.ty === 'gs') {
        const geoms = [];
        collectGeoms(list, i, [], geoms);
        const c2 = Object.assign({}, ctx, { geomCount: geoms.length });
        for (const g of geoms) emitPath(host, it, g, c2);
      } else if (it.ty === 'gr') {
        const tr = (it.it || []).find(x => x && x.ty === 'tr');
        const g = addTransform(host, tr, ctx.map, it.nm || 'group');
        const alpha = tr && tr.o ? ctx.alpha.concat([numTrack(tr.o, ctx.map, 0, 'num', v => v / 100, 100)]) : ctx.alpha;
        renderShapes(it.it, g, Object.assign({}, ctx, { alpha }));
      } else if (it.ty === 'mm') warn('merge');
      else if (it.ty === 'rp') warn('repeater');
      else if (it.ty === 'rd') warn('roundcorner');
      else if (it.ty === 'tw' || it.ty === 'pb' || it.ty === 'op' || it.ty === 'zz') warn('twist');
      else if (!GEOM[it.ty] && it.ty !== 'tm') warn('unknownShape');
    }
  }

  /** Adds clip-path tracks to `host`; each extra clip nests one group deeper. Returns the innermost group. */
  function addClips(host, tracks, label) {
    tracks.forEach((track, k) => {
      if (k > 0) {
        const g = node('group', uname(label + '_clip'));
        host.children.push(g);
        host = g;
      }
      const c = node('clip-path', uname(label + '_clip'));
      c.tracks.pathData = track;
      host.children.unshift(c);
      host.clipped = true;
    });
    return host;
  }

  /** Size of the "everything" rectangle used for inverted clips. */
  const clipBound = 10 * Math.max(W, H) + 10000;

  function renderComp(layers, ctx, parent) {
    const byInd = new Map();
    layers.forEach(l => { if (l && l.ind != null) byInd.set(l.ind, l); });

    /** Layer plus its parents, outermost first. */
    const parentChain = L => {
      const chain = [];
      let cur = L;
      const seen = new Set([L]);
      while (cur) {
        chain.unshift(cur);
        if (cur.parent == null) break;
        const p = byInd.get(cur.parent);
        if (!p || seen.has(p)) break;
        seen.add(p);
        cur = p;
      }
      return chain;
    };

    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (!L || L.hd || L.td) continue;
      if (L.ddd) warn('d3');
      if (L.ef && L.ef.length) warn('effects');
      if (L.tm) warn('timeremap');
      const vis = visTrack(L, ctx.map);
      if (!vis.animated && vis.at(0) === 0) continue;
      if (L.ty === 3) continue; // null layer
      if (L.ty === 2) { warn('image'); continue; }
      if (L.ty === 5) { warn('text'); continue; }
      if (![0, 1, 4].includes(L.ty)) { warn('unknownLayer'); continue; }

      const chain = parentChain(L);
      const lm = ctx.map;
      const alpha = ctx.alpha.concat([numTrack(L.ks && L.ks.o, lm, 0, 'num', v => v / 100, 100), vis]);
      let host = parent;
      let start = 0;

      // Track matte: clip in the space of the ancestors both layers share.
      if (L.tt) {
        const matte = L.tp != null ? byInd.get(L.tp) : layers[i - 1];
        const inverted = L.tt === 2 || L.tt === 4;
        if (!matte) {
          warn('matteUnsupported');
        } else {
          const mChain = parentChain(matte);
          let k = 0;
          while (k < chain.length - 1 && k < mChain.length - 1 && chain[k] === mChain[k]) k++;
          const res = matteClip({
            matte, restChain: mChain.slice(k), mapOf: () => ctx.map, inverted, bound: clipBound,
          });
          if (res.unsupported) {
            warn(res.unsupported === 'stroke' ? 'matteStroke' : 'matteUnsupported');
          } else {
            if (L.tt === 3 || L.tt === 4) warn('matteLuma');
            if (res.flags.soft) warn('matteSoft');
            if (res.flags.stroke) warn('matteStroke');
            for (; start < k; start++) host = addTransform(host, chain[start].ks, ctx.map, chain[start].nm || 'layer');
            const wrap = node('group', uname((L.nm || 'layer') + '_matte'));
            host.children.push(wrap);
            host = addClips(wrap, [res.track], matte.nm || 'matte');
            // Outside the matte's in/out range an alpha matte hides the layer.
            if (!inverted) alpha.push(visTrack(matte, ctx.map));
          }
        }
      }

      for (; start < chain.length; start++) host = addTransform(host, chain[start].ks, ctx.map, chain[start].nm || 'layer');

      // Masks: clip in the layer's own space.
      if (L.masksProperties && L.masksProperties.length) {
        host = addClips(host, maskClips(L.masksProperties, lm, { bound: clipBound, warn }), (L.nm || 'layer') + '_mask');
      }

      if (L.ty === 4) {
        renderShapes(L.shapes, host, { map: lm, alpha });
      } else if (L.ty === 1) {
        const sw = L.sw || 0, sh = L.sh || 0;
        const p = node('path', uname(L.nm || 'solid'));
        host.children.push(p);
        p.tracks.pathData = constTrack('M0,0 L' + fmt(sw) + ',0 L' + fmt(sw) + ',' + fmt(sh) + ' L0,' + fmt(sh) + ' Z', 'pathType');
        const hex = (L.sc || '#000000').replace('#', '');
        p.tracks.fillColor = constTrack([0, 2, 4].map(o => parseInt(hex.slice(o, o + 2), 16) / 255), 'colorType');
        p.tracks.fillAlpha = prodTrack(alpha);
      } else if (L.ty === 0) {
        const a = assets[L.refId];
        if (a && Array.isArray(a.layers) && (ctx.depth || 0) < 12) {
          renderComp(a.layers, { map: innerCompMap(ctx.map, L), alpha, depth: (ctx.depth || 0) + 1 }, host);
        }
      }
    }
  }

  renderComp(json.layers, { map: { a: 1, b: 0 }, alpha: [], depth: 0 }, root);

  // Drop groups that draw nothing (a group holding only a clip-path draws nothing).
  const drawsSomething = n => n.children.some(c => c.tag === 'path' || (c.tag === 'group' && drawsSomething(c)));
  (function prune(n) {
    n.children = n.children.filter(c => {
      if (c.tag === 'path' || c.tag === 'clip-path') return true;
      prune(c);
      return drawsSomething(c);
    });
  })(root);

  /* ---------- track compilation ---------- */

  const eqTol = type => (type === 'colorType' ? 1 / 512 : Math.max(Math.pow(10, -getPrecision()) / 2, 1e-6));
  let baked = 0;

  /** Samples a track and simplifies it into linear segments. */
  function bake(track) {
    const fs = [];
    for (let f = ip; f < op - 1e-9; f += step) fs.push(f);
    fs.push(op);
    const raw = fs.map(f => track.at(f));

    if (track.type === 'pathType') {
      const sig = s => s.replace(/-?\d*\.?\d+(e[-+]?\d+)?/gi, '#');
      const segs = [];
      const s0 = sig(raw[0]);
      for (let i = 0; i < raw.length - 1; i++) {
        if (raw[i] === raw[i + 1]) continue;
        if (sig(raw[i + 1]) !== s0) { warn('morph'); return []; }
        segs.push({ f0: fs[i], f1: fs[i + 1], v0: raw[i], v1: raw[i + 1], ease: null });
      }
      return segs;
    }

    const vec = raw.map(v => (Array.isArray(v) ? v : [v]));
    const eps = eqTol(track.type);
    const segs = [];
    let s = 0;
    while (s < fs.length - 1) {
      let e = s + 1;
      // Extend the segment while all intermediate samples stay on the line.
      while (e + 1 < fs.length) {
        const c = e + 1;
        let ok = true;
        for (let k = s + 1; k < c && ok; k++) {
          const p = (fs[k] - fs[s]) / (fs[c] - fs[s]);
          for (let d = 0; d < vec[s].length; d++) {
            const lv = vec[s][d] + (vec[c][d] - vec[s][d]) * p;
            if (Math.abs(lv - vec[k][d]) > eps) { ok = false; break; }
          }
        }
        if (!ok) break;
        e = c;
      }
      const same = vec[s].every((v, d) => Math.abs(v - vec[e][d]) <= eps);
      if (!same) segs.push({ f0: fs[s], f1: fs[e], v0: raw[s], v1: raw[e], ease: null });
      s = e;
    }
    return segs;
  }

  function trackSegs(track) {
    if (!track.animated) return [];
    const segs = track.exact();
    if (segs) {
      const eq = (a, b) => fmtVal(track.type, a) === fmtVal(track.type, b);
      let ok = true;
      const out = [];
      for (const s of segs) {
        if (s.hold || s.f1 <= s.f0) {
          if (s.f1 > ip + 1e-6 && s.f1 < op - 1e-6 && !eq(s.v0, s.v1)) out.push(Object.assign({}, s, { hold: true }));
          continue;
        }
        if (s.f1 <= ip + 1e-6 || s.f0 >= op - 1e-6) continue;
        if (s.f0 < ip - 1e-6 || s.f1 > op + 1e-6) { ok = false; break; }
        if (!eq(s.v0, s.v1)) out.push(s);
      }
      if (ok) return out;
    }
    baked++;
    return bake(track);
  }

  function compileNode(n) {
    n.attrs = {};
    n.anims = [];
    for (const k in n.stat) n.attrs[k] = typeof n.stat[k] === 'number' ? fmt(n.stat[k]) : String(n.stat[k]);
    for (const k in n.tracks) {
      const t = n.tracks[k];
      n.attrs[k] = fmtVal(t.type, t.at(ip));
      const segs = trackSegs(t);
      if (segs.length) n.anims.push({ prop: k, type: t.type, segs });
    }
    for (const k in DEFAULTS) {
      if (n.attrs[k] === DEFAULTS[k] && !n.anims.some(a => a.prop === k)) delete n.attrs[k];
    }
    n.children.forEach(compileNode);
  }
  root.children.forEach(compileNode);

  // Inline groups that have no effect.
  (function flatten(n) {
    const out = [];
    for (const c of n.children) {
      if (c.tag === 'group') {
        flatten(c);
        // A clip-path only affects its own group, so clipped groups must stay.
        const clips = c.children.some(x => x.tag === 'clip-path');
        if (!clips && !c.anims.length && Object.keys(c.attrs).length === 0) { out.push(...c.children); continue; }
      }
      out.push(c);
    }
    n.children = out;
  })(root);

  /* ---------- output ---------- */

  const { xml, stats, durMs } = writeXml(root, { W, H, fr, ip, dp: opts.dp });
  if (!stats.animators) warn('noAnim');

  const warnings = [...warns.values()];
  if (baked) warnings.push({ key: 'baked', count: 1, params: { n: baked }, info: true });
  return { xml, warnings, stats, durMs, W, H, fr, ip, op };
}
