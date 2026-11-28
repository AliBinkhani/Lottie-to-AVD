/**
 * Minimal in-browser AnimatedVectorDrawable renderer.
 * Parses AVD XML (inline aapt:attr form) and renders it as SVG at a given time.
 */
import { clamp, makeBezier } from '../core/math.js';
import { ANDROID_NS } from '../converter/xml-writer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Error with a translatable code. */
export class PlayerError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail;
  }
}

const NAMED = {
  linear_interpolator: t => t,
  accelerate_decelerate_interpolator: t => Math.cos((t + 1) * Math.PI) / 2 + 0.5,
  accelerate_interpolator: t => t * t,
  decelerate_interpolator: t => 1 - (1 - t) * (1 - t),
  fast_out_slow_in: makeBezier(0.4, 0, 0.2, 1),
  linear_out_slow_in: makeBezier(0, 0, 0.2, 1),
  fast_out_linear_in: makeBezier(0.4, 0, 1, 1),
};

function ga(el, n) {
  let v = el.getAttributeNS(ANDROID_NS, n);
  if (v == null || v === '') v = el.getAttribute('android:' + n);
  return v == null || v === '' ? null : v;
}
const kidsOf = el => Array.from(el.children);
const aaptOf = (el, name) => kidsOf(el).find(c => c.localName === 'attr' && c.getAttribute('name') === name);

/** Parses #RGB/#ARGB/#RRGGBB/#AARRGGBB into [a, r, g, b] in 0..1. */
function parseColor(s) {
  if (!s || s[0] !== '#') return null;
  let h = s.slice(1);
  if (h.length === 3) h = 'F' + h;
  if (h.length === 4) h = h.split('').map(c => c + c).join('');
  if (h.length === 6) h = 'FF' + h;
  if (h.length !== 8) return null;
  return [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}

function tokenizePath(s) {
  const t = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(s))) t.push(m[1] ? m[1] : +m[2]);
  return t;
}

function parseVal(type, s) {
  if (s == null) return null;
  if (type === 'colorType') return parseColor(s);
  if (type === 'pathType') return { s, t: tokenizePath(s) };
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

function lerpVal(type, a, b, p) {
  if (a == null) return b;
  if (b == null) return a;
  if (type === 'colorType') return a.map((v, i) => v + (b[i] - v) * p);
  if (type === 'pathType') {
    if (a.t.length !== b.t.length) return p < 1 ? a : b;
    const t = a.t.map((v, i) => (typeof v === 'number' && typeof b.t[i] === 'number' ? v + (b.t[i] - v) * p : v));
    return { s: t.join(' '), t };
  }
  return a + (b - a) * p;
}

function parseInterpolator(el) {
  const ref = ga(el, 'interpolator');
  if (ref) return NAMED[ref.split('/').pop()] || NAMED.accelerate_decelerate_interpolator;
  const ia = aaptOf(el, 'android:interpolator');
  const pi = ia && kidsOf(ia)[0];
  if (pi) {
    if (pi.localName === 'pathInterpolator') {
      const x1 = ga(pi, 'controlX1'), y1 = ga(pi, 'controlY1'), x2 = ga(pi, 'controlX2'), y2 = ga(pi, 'controlY2');
      if (x1 != null && x2 != null) return makeBezier(+x1, +(y1 || 0), +x2, +(y2 || 1));
      if (x1 != null) {
        // Quadratic -> cubic.
        const qx = +x1, qy = +(y1 || 0);
        return makeBezier(2 / 3 * qx, 2 / 3 * qy, 1 + 2 / 3 * (qx - 1), 1 + 2 / 3 * (qy - 1));
      }
      const pd = ga(pi, 'pathData');
      if (pd) {
        const n = (pd.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
        if (n.length >= 8) return makeBezier(n[2], n[3], n[4], n[5]);
      }
      return t => t;
    }
    if (pi.localName === 'linearInterpolator') return t => t;
    if (pi.localName === 'accelerateInterpolator') return NAMED.accelerate_interpolator;
    if (pi.localName === 'decelerateInterpolator') return NAMED.decelerate_interpolator;
  }
  return NAMED.accelerate_decelerate_interpolator;
}

let playerCount = 0;

/** Reads an Android <gradient> into { type, x1, y1, x2, y2, cx, cy, r, stops }. */
function parseGradient(g) {
  const n = (k, d) => { const v = ga(g, k); return v == null || isNaN(+v) ? d : +v; };
  let stops = kidsOf(g).filter(c => c.localName === 'item').map(it => {
    const c = parseColor(ga(it, 'color')) || [1, 0, 0, 0];
    const o = parseFloat(ga(it, 'offset'));
    return { offset: clamp(isNaN(o) ? 0 : o, 0, 1), color: c };
  });
  if (!stops.length) {
    // startColor / centerColor / endColor form.
    const sc = parseColor(ga(g, 'startColor')), cc = parseColor(ga(g, 'centerColor')), ec = parseColor(ga(g, 'endColor'));
    if (sc) stops.push({ offset: 0, color: sc });
    if (cc) stops.push({ offset: 0.5, color: cc });
    if (ec) stops.push({ offset: 1, color: ec });
  }
  return {
    type: ga(g, 'type') || 'linear',
    x1: n('startX', 0), y1: n('startY', 0), x2: n('endX', 0), y2: n('endY', 0),
    cx: n('centerX', 0), cy: n('centerY', 0), r: n('gradientRadius', 0),
    tile: ga(g, 'tileMode') || 'clamp',
    stops,
  };
}

/** Creates an SVG gradient element for a parsed Android gradient. */
function svgGradient(spec, id) {
  const radial = spec.type === 'radial';
  const el = document.createElementNS(SVG_NS, radial ? 'radialGradient' : 'linearGradient');
  el.setAttribute('id', id);
  el.setAttribute('gradientUnits', 'userSpaceOnUse');
  if (radial) {
    el.setAttribute('cx', spec.cx); el.setAttribute('cy', spec.cy); el.setAttribute('r', spec.r);
  } else {
    el.setAttribute('x1', spec.x1); el.setAttribute('y1', spec.y1);
    el.setAttribute('x2', spec.x2); el.setAttribute('y2', spec.y2);
  }
  el.setAttribute('spreadMethod', spec.tile === 'mirror' ? 'reflect' : spec.tile === 'repeat' ? 'repeat' : 'pad');
  for (const st of spec.stops) {
    const s = document.createElementNS(SVG_NS, 'stop');
    s.setAttribute('offset', st.offset);
    s.setAttribute('stop-color', 'rgb(' + st.color.slice(1).map(v => Math.round(v * 255)).join(',') + ')');
    s.setAttribute('stop-opacity', st.color[0]);
    el.appendChild(s);
  }
  return el;
}

const guessType = p => (p === 'pathData' ? 'pathType' : (p === 'fillColor' || p === 'strokeColor') ? 'colorType' : 'floatType');

export class AVDPlayer {
  constructor(host) {
    this.host = host;
    this.nodes = [];
    this.duration = 0;
    this.uid = 'avd' + (++playerCount);
  }

  /** Parses AVD XML and builds the SVG. Throws PlayerError on invalid input. */
  load(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const pe = doc.getElementsByTagName('parsererror')[0];
    if (pe) throw new PlayerError('xmlParse', (pe.textContent || '').trim().split('\n')[0]);
    const root = doc.documentElement;
    if (root.localName !== 'animated-vector') throw new PlayerError('xmlRoot');
    const dr = aaptOf(root, 'android:drawable');
    const vec = dr && kidsOf(dr).find(c => c.localName === 'vector');
    if (!vec) throw new PlayerError('xmlNoVector');

    const vw = +ga(vec, 'viewportWidth') || 24, vh = +ga(vec, 'viewportHeight') || 24;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (ga(vec, 'alpha') != null) svg.style.opacity = ga(vec, 'alpha');

    this.nodes = [];
    this.duration = 0;
    const byName = new Map();
    const defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);
    let gradCount = 0;

    let clipCount = 0;

    // A <clip-path> clips the siblings after it, so each one opens a new
    // clipped <g> that the following siblings are added to.
    const build = (el, parentSvg) => {
      let container = parentSvg;
      for (const c of kidsOf(el)) {
        const tag = c.localName;
        if (tag !== 'group' && tag !== 'path' && tag !== 'clip-path') continue;
        const n = {
          tag, base: {}, anims: {}, last: {},
          el: document.createElementNS(SVG_NS, tag === 'group' ? 'g' : 'path'),
        };
        for (const a of Array.from(c.attributes)) {
          if (a.name.startsWith('xmlns')) continue;
          const key = a.name.startsWith('android:') ? a.name.slice(8) : (a.namespaceURI === ANDROID_NS ? a.localName : null);
          if (key) n.base[key] = a.value;
        }
        if (c.localName === 'path') {
          for (const attr of ['fillColor', 'strokeColor']) {
            const wrap = aaptOf(c, 'android:' + attr);
            const g = wrap && kidsOf(wrap).find(k => k.localName === 'gradient');
            if (!g) continue;
            const id = this.uid + '-g' + (++gradCount);
            defs.appendChild(svgGradient(parseGradient(g), id));
            n.gradients = n.gradients || {};
            n.gradients[attr] = 'url(#' + id + ')';
          }
        }
        if (tag === 'clip-path') {
          const id = this.uid + '-c' + (++clipCount);
          const cp = document.createElementNS(SVG_NS, 'clipPath');
          cp.setAttribute('id', id);
          cp.appendChild(n.el);
          defs.appendChild(cp);
          const g = document.createElementNS(SVG_NS, 'g');
          g.setAttribute('clip-path', 'url(#' + id + ')');
          container.appendChild(g);
          container = g;
        } else {
          container.appendChild(n.el);
        }
        this.nodes.push(n);
        if (n.base.name) byName.set(n.base.name, n);
        if (tag === 'group') build(c, n.el);
      }
    };
    build(vec, svg);

    const collect = (el, off, n) => {
      if (el.localName === 'set') {
        const seq = ga(el, 'ordering') === 'sequentially';
        let t = off, end = off;
        for (const c of kidsOf(el)) {
          if (c.localName !== 'set' && c.localName !== 'objectAnimator') continue;
          const e = collect(c, seq ? t : off, n);
          if (seq) t = e;
          end = Math.max(end, e);
        }
        return end;
      }
      if (el.localName === 'objectAnimator') {
        const start = off + (+ga(el, 'startOffset') || 0);
        const dur = ga(el, 'duration') != null ? +ga(el, 'duration') : 300;
        const prop = ga(el, 'propertyName');
        if (!prop) return start + dur;
        const type = ga(el, 'valueType') || guessType(prop);
        (n.anims[prop] = n.anims[prop] || []).push({
          start, dur, type,
          from: parseVal(type, ga(el, 'valueFrom')),
          to: parseVal(type, ga(el, 'valueTo')),
          interp: parseInterpolator(el),
        });
        this.duration = Math.max(this.duration, start + dur);
        return start + dur;
      }
      return off;
    };

    for (const t of kidsOf(root)) {
      if (t.localName !== 'target') continue;
      const n = byName.get(ga(t, 'name'));
      if (!n) continue;
      const aa = aaptOf(t, 'android:animation');
      const first = aa && kidsOf(aa)[0];
      if (first) collect(first, 0, n);
    }
    this.nodes.forEach(n => { for (const k in n.anims) n.anims[k].sort((a, b) => a.start - b.start); });

    this.host.innerHTML = '';
    this.host.appendChild(svg);
    this.render(0);
  }

  value(n, prop, ms, type) {
    let v = n.base[prop] != null ? parseVal(type, n.base[prop]) : null;
    const list = n.anims[prop];
    if (!list) return v;
    for (const a of list) {
      if (ms < a.start) break;
      if (a.dur <= 0 || ms >= a.start + a.dur) v = a.to != null ? a.to : v;
      else v = lerpVal(a.type, a.from != null ? a.from : v, a.to, clamp(a.interp((ms - a.start) / a.dur), -2, 3));
    }
    return v;
  }

  set(n, k, v) {
    if (n.last[k] !== v) {
      n.last[k] = v;
      if (v == null) n.el.removeAttribute(k); else n.el.setAttribute(k, v);
    }
  }

  /** Renders the drawable at time `ms`. */
  render(ms) {
    const rgb = c => 'rgb(' + c.slice(1).map(v => Math.round(clamp(v, 0, 1) * 255)).join(',') + ')';
    for (const n of this.nodes) {
      const f = (k, d) => { const v = this.value(n, k, ms, 'floatType'); return v == null || isNaN(v) ? d : v; };
      if (n.tag === 'group') {
        const px = f('pivotX', 0), py = f('pivotY', 0);
        this.set(n, 'transform',
          'translate(' + (f('translateX', 0) + px) + ' ' + (f('translateY', 0) + py) + ') rotate(' + f('rotation', 0) +
          ') scale(' + f('scaleX', 1) + ' ' + f('scaleY', 1) + ') translate(' + (-px) + ' ' + (-py) + ')');
        continue;
      }
      const d = this.value(n, 'pathData', ms, 'pathType');
      this.set(n, 'd', d ? d.s : null);
      if (n.tag === 'clip-path') continue;

      const grad = n.gradients || {};
      const fc = this.value(n, 'fillColor', ms, 'colorType');
      if (grad.fillColor) {
        this.set(n, 'fill', grad.fillColor);
        this.set(n, 'fill-opacity', String(clamp(f('fillAlpha', 1), 0, 1)));
      } else if (fc) {
        this.set(n, 'fill', rgb(fc));
        this.set(n, 'fill-opacity', String(clamp(fc[0] * f('fillAlpha', 1), 0, 1)));
      } else this.set(n, 'fill', 'none');
      this.set(n, 'fill-rule', n.base.fillType === 'evenOdd' ? 'evenodd' : 'nonzero');

      const sc = this.value(n, 'strokeColor', ms, 'colorType'), sw = f('strokeWidth', 0);
      if (!((sc || grad.strokeColor) && sw > 0)) { this.set(n, 'stroke', 'none'); continue; }
      this.set(n, 'stroke', grad.strokeColor || rgb(sc));
      this.set(n, 'stroke-opacity', String(clamp((grad.strokeColor ? 1 : sc[0]) * f('strokeAlpha', 1), 0, 1)));
      this.set(n, 'stroke-width', String(sw));
      this.set(n, 'stroke-linecap', n.base.strokeLineCap || 'butt');
      this.set(n, 'stroke-linejoin', n.base.strokeLineJoin || 'miter');
      this.set(n, 'stroke-miterlimit', n.base.strokeMiterLimit || '4');

      // Trim path via normalised pathLength + dash array.
      const ts = f('trimPathStart', 0), te = f('trimPathEnd', 1), to = f('trimPathOffset', 0);
      if (Math.abs(ts) > 1e-6 || Math.abs(te - 1) > 1e-6 || Math.abs(to) > 1e-6) {
        const len = Math.abs(te - ts);
        if (len < 1e-6) {
          this.set(n, 'stroke', 'none');
        } else {
          const s = (((Math.min(ts, te) + to) % 1) + 1) % 1, e = s + len;
          this.set(n, 'pathLength', '1');
          if (e <= 1 + 1e-6) {
            this.set(n, 'stroke-dasharray', len + ' 2');
            this.set(n, 'stroke-dashoffset', String(-s));
          } else {
            this.set(n, 'stroke-dasharray', (e - 1) + ' ' + (s - (e - 1)) + ' ' + (1 - s) + ' 2');
            this.set(n, 'stroke-dashoffset', '0');
          }
        }
      } else {
        this.set(n, 'pathLength', null);
        this.set(n, 'stroke-dasharray', null);
        this.set(n, 'stroke-dashoffset', null);
      }
    }
  }
}
