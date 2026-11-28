// Generates the small Lottie files used only by the tests.
//   node tests/fixtures/generate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const st = v => ({ a: 0, k: v });
const lin = { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } };
const ease = { i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } };
const TR = () => ({ ty: 'tr', p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100) });
const KS = extra => Object.assign({ o: st(100), r: st(0), p: st([0, 0, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) }, extra);
const fill = (c, r = 1) => ({ ty: 'fl', c: st(c), o: st(100), r });
const grp = (...it) => ({ ty: 'gr', it: [...it, TR()] });
const shape = (ind, nm, ks, shapes, extra = {}) =>
  Object.assign({ ddd: 0, ind, ty: 4, nm, sr: 1, ip: 0, op: 90, st: 0, ks: KS(ks), shapes }, extra);
const doc = (nm, w, h, op, layers, assets = []) => ({ v: '5.7.4', fr: 30, ip: 0, op, w, h, nm, ddd: 0, assets, layers });
const write = (name, json) => fs.writeFileSync(path.join(DIR, name), JSON.stringify(json, null, 1) + '\n');

// Layer start time (st) and stretch (sr): a shape layer's own keyframes are in
// composition time; st/sr only shift a precomp's inner timeline.
const box = c => [grp({ ty: 'rc', p: st([0, 0]), s: st([40, 40]), r: st(0) }, fill(c))];
write('precomp-timing.json', doc('precomp timing', 100, 100, 90, [
  { ty: 0, refId: 'inner', ind: 1, st: 30, ip: 30, op: 90, sr: 1.5, w: 100, h: 100, ks: KS({ p: st([50, 50, 0]), a: st([50, 50, 0]) }) },
  shape(2, 'late opacity', { p: st([20, 20, 0]), o: { a: 1, k: [Object.assign({ t: 10, s: [0] }, lin), { t: 50, s: [100] }] } },
    box([1, 0.3, 0.2, 1]), { st: 40 }),
], [{ id: 'inner', layers: [
  shape(1, 'spinner', { p: st([50, 50, 0]), r: { a: 1, k: [Object.assign({ t: 0, s: [0] }, lin), { t: 20, s: [90] }] } },
    box([0, 0.6, 1, 1]), { op: 200 }),
] }]));

// Holes: several shapes under one fill form one path.
const ell = (s, d = 1, sAnim) => ({ ty: 'el', d, p: st([0, 0]), s: sAnim || st(s) });
const rect = (s, d = 1) => ({ ty: 'rc', d, p: st([0, 0]), s: st(s), r: st(0) });
write('holes.json', doc('holes', 200, 100, 60, [
  // Non-zero ring: inner ellipse drawn counter-clockwise (d = 3), size animated.
  shape(1, 'nonzero ring', { p: st([40, 50, 0]) }, [grp(
    ell([60, 60]),
    ell(null, 3, { a: 1, k: [Object.assign({ t: 0, s: [20, 20] }, { i: { x: [0.4, 0.4], y: [1, 1] }, o: { x: [0.6, 0.6], y: [0, 0] } }), { t: 60, s: [44, 44] }] }),
    fill([0.36, 0.27, 0.91, 1]))]),
  // Even-odd frame: two rectangles in the same direction.
  shape(2, 'even-odd frame', { p: st([100, 50, 0]) }, [grp(rect([56, 56]), rect([30, 30]), fill([0.96, 0.45, 0.27, 1], 2))]),
  // Hand-drawn path with a counter-clockwise inner contour.
  shape(3, 'path ring', { p: st([160, 50, 0]) }, [grp(
    { ty: 'sh', ks: st({ v: [[-28, -28], [28, -28], [28, 28], [-28, 28]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true }) },
    { ty: 'sh', ks: st({ v: [[-12, -12], [-12, 12], [12, 12], [12, -12]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true }) },
    fill([0.12, 0.62, 0.42, 1]))]),
]));

// Motion paths: straight spatial tangents are exact; a real curve is sampled.
const dot = c => [grp(ell([24, 24]), fill(c))];
const posKf = (t, s, to, ti) => Object.assign({ t, s, to, ti }, { i: { x: 0.4, y: 1 }, o: { x: 0.6, y: 0 } });
write('motion-path.json', doc('motion paths', 200, 120, 60, [
  shape(1, 'straight', { p: { a: 1, k: [posKf(0, [30, 30, 0], [20, 5, 0], [0, 0, 0]), posKf(30, [170, 65, 0], [0, 0, 0], [20, 5, 0]), { t: 60, s: [30, 30, 0] }] } },
    dot([0.36, 0.27, 0.91, 1])),
  shape(2, 'curved', { p: { a: 1, k: [posKf(0, [30, 95, 0], [40, -60, 0], [-40, -60, 0]), posKf(30, [170, 95, 0], [-40, -60, 0], [40, -60, 0]), { t: 60, s: [30, 95, 0] }] } },
    dot([0.96, 0.45, 0.27, 1])),
]));

console.log('fixtures written to', DIR);
