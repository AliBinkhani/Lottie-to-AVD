/** Serialises a compiled scene into AnimatedVectorDrawable XML. */
import { fmt, fmtVal } from '../core/format.js';
import { clamp } from '../core/math.js';

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
export const AAPT_NS = 'http://schemas.android.com/aapt';

const GROUP_ATTRS = ['name', 'pivotX', 'pivotY', 'rotation', 'scaleX', 'scaleY', 'translateX', 'translateY'];
const PATH_ATTRS = ['name', 'pathData', 'fillColor', 'fillAlpha', 'fillType', 'strokeColor', 'strokeAlpha',
  'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'strokeMiterLimit', 'trimPathStart', 'trimPathEnd', 'trimPathOffset'];

/** #AARRGGBB for a gradient stop. */
function argbHex(rgb, alpha) {
  const h = v => Math.round(clamp(v || 0, 0, 1) * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(alpha) + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

const isLinear = c => !c || (Math.abs(c.x1 - c.y1) < 1e-6 && Math.abs(c.x2 - c.y2) < 1e-6);
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param root  compiled scene root ({ children: [...] })
 * @param meta  { W, H, fr, ip, dp }
 * @returns {{ xml: string, stats: object, durMs: number }}
 */
export function writeXml(root, { W, H, fr, ip, dp }) {
  const doc = document.implementation.createDocument(null, 'animated-vector', null);
  const rootEl = doc.documentElement;
  const setA = (e, k, v) => e.setAttributeNS(ANDROID_NS, 'android:' + k, String(v));
  const aaptAttr = name => {
    const e = doc.createElementNS(AAPT_NS, 'aapt:attr');
    e.setAttribute('name', name);
    return e;
  };

  const dpW = Math.max(1, +dp || W), dpH = dpW * H / W;
  const drawable = aaptAttr('android:drawable');
  rootEl.appendChild(drawable);
  const vec = doc.createElement('vector');
  drawable.appendChild(vec);
  setA(vec, 'width', fmt(dpW) + 'dp');
  setA(vec, 'height', fmt(dpH) + 'dp');
  setA(vec, 'viewportWidth', fmt(W));
  setA(vec, 'viewportHeight', fmt(H));

  const stats = { groups: 0, paths: 0, animators: 0, targets: 0, gradients: 0 };

  /** <aapt:attr name="android:fillColor|strokeColor"><gradient …/></aapt:attr> */
  function gradientEl({ attr, spec }) {
    const wrap = aaptAttr('android:' + attr);
    const g = doc.createElement('gradient');
    setA(g, 'type', spec.type);
    if (spec.type === 'radial') {
      setA(g, 'centerX', fmt(spec.start[0]));
      setA(g, 'centerY', fmt(spec.start[1]));
      setA(g, 'gradientRadius', fmt(Math.max(spec.radius, 1e-3)));
    } else {
      setA(g, 'startX', fmt(spec.start[0]));
      setA(g, 'startY', fmt(spec.start[1]));
      setA(g, 'endX', fmt(spec.end[0]));
      setA(g, 'endY', fmt(spec.end[1]));
    }
    setA(g, 'tileMode', 'clamp');
    // Android needs at least two stops.
    const stops = spec.stops.length === 1
      ? [Object.assign({}, spec.stops[0], { offset: 0 }), Object.assign({}, spec.stops[0], { offset: 1 })]
      : spec.stops;
    for (const st of stops) {
      const item = doc.createElement('item');
      setA(item, 'offset', fmt(st.offset));
      setA(item, 'color', argbHex(st.color, st.alpha));
      g.appendChild(item);
    }
    wrap.appendChild(g);
    return wrap;
  }
  const targets = [];
  (function emit(n, parentEl) {
    for (const c of n.children) {
      const e = doc.createElement(c.tag);
      c.attrs.name = c.name;
      for (const k of (c.tag === 'group' ? GROUP_ATTRS : PATH_ATTRS)) if (c.attrs[k] != null) setA(e, k, c.attrs[k]);
      if (c.gradient) {
        e.appendChild(gradientEl(c.gradient));
        stats.gradients++;
      }
      parentEl.appendChild(e);
      if (c.tag === 'group') stats.groups++; else stats.paths++;
      if (c.anims.length) targets.push(c);
      if (c.tag === 'group') emit(c, e);
    }
  })(root, vec);

  let durMs = 0;
  for (const n of targets) {
    const t = doc.createElement('target');
    setA(t, 'name', n.name);
    rootEl.appendChild(t);
    const aa = aaptAttr('android:animation');
    t.appendChild(aa);
    const set = doc.createElement('set');
    setA(set, 'ordering', 'together');
    aa.appendChild(set);
    stats.targets++;

    for (const an of n.anims) {
      for (const s of an.segs) {
        const startF = s.hold ? s.f1 : s.f0;
        const st = Math.round((startF - ip) / fr * 1000);
        const en = Math.round((s.f1 - ip) / fr * 1000);
        const o = doc.createElement('objectAnimator');
        setA(o, 'propertyName', an.prop);
        if (st > 0) setA(o, 'startOffset', st);
        setA(o, 'duration', Math.max(0, en - st));
        setA(o, 'valueFrom', fmtVal(an.type, s.v0));
        setA(o, 'valueTo', fmtVal(an.type, s.v1));
        setA(o, 'valueType', an.type);
        if (s.hold || isLinear(s.ease)) {
          setA(o, 'interpolator', '@android:anim/linear_interpolator');
        } else {
          const ia = aaptAttr('android:interpolator');
          const pi = doc.createElement('pathInterpolator');
          setA(pi, 'controlX1', fmt(s.ease.x1));
          setA(pi, 'controlY1', fmt(s.ease.y1));
          setA(pi, 'controlX2', fmt(s.ease.x2));
          setA(pi, 'controlY2', fmt(s.ease.y2));
          ia.appendChild(pi);
          o.appendChild(ia);
        }
        set.appendChild(o);
        stats.animators++;
        durMs = Math.max(durMs, en);
      }
    }
  }

  function pretty(el, ind) {
    const attrs = Array.from(el.attributes).map(a => ({ name: a.name, value: a.value }));
    if (el === rootEl) attrs.unshift({ name: 'xmlns:android', value: ANDROID_NS }, { name: 'xmlns:aapt', value: AAPT_NS });
    let s = ind + '<' + el.tagName;
    attrs.forEach((a, i) => { s += (i === 0 || attrs.length < 2 ? ' ' : '\n' + ind + '    ') + a.name + '="' + esc(a.value) + '"'; });
    const kids = Array.from(el.children);
    if (!kids.length) return s + ' />';
    return s + '>\n' + kids.map(k => pretty(k, ind + '    ')).join('\n') + '\n' + ind + '</' + el.tagName + '>';
  }

  const xml = '<?xml version="1.0" encoding="utf-8"?>\n' + pretty(rootEl, '') + '\n';
  return { xml, stats, durMs };
}
