// Renders the PNG / ICO icons and the social preview image from
// assets/icons/favicon.svg. Run after changing the SVG:
//   npm run icons
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'assets/icons');
const svg = fs.readFileSync(path.join(DIR, 'favicon.svg'), 'utf8');
const dataUrl = s => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');

// Full-bleed square (platforms that round the corners themselves).
const square = svg.replace('rx="15"', 'rx="0"');
// Maskable: full bleed, artwork shrunk into the 80% safe zone.
const maskable = square
  .replace('<path', '<g transform="translate(32 32) scale(.8) translate(-32 -32)"><path')
  .replace('</svg>', '</g></svg>');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(source, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>body{margin:0}</style><img src="${dataUrl(source)}" width="${size}" height="${size}">`);
  await page.locator('img').evaluate(img => img.decode());
  const buf = await page.screenshot({ omitBackground: true });
  if (file) fs.writeFileSync(path.join(DIR, file), buf);
  return buf;
}

await png(svg, 192, 'icon-192.png');
await png(svg, 512, 'icon-512.png');
await png(maskable, 512, 'icon-maskable-512.png');
await png(square, 180, 'apple-touch-icon.png');

// favicon.ico with PNG entries (16, 32, 48).
const entries = [];
for (const s of [16, 32, 48]) entries.push({ s, data: await png(svg, s) });
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ s, data }, i) => {
  const o = 6 + 16 * i;
  header.writeUInt8(s, o); header.writeUInt8(s, o + 1);
  header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6);
  header.writeUInt32LE(data.length, o + 8); header.writeUInt32LE(offset, o + 12);
  offset += data.length;
});
fs.writeFileSync(path.join(DIR, 'favicon.ico'), Buffer.concat([header, ...entries.map(e => e.data)]));

// Social preview (Open Graph / Twitter), 1200x630.
const fonts = fs.readFileSync(path.join(ROOT, 'src/css/fonts.css'), 'utf8')
  .replace(/url\("\.\.\/\.\.\/([^"]+)"\)/g, (_, f) =>
    `url("data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, f)).toString('base64')}")`);
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>${fonts}
  body{margin:0;width:1200px;height:630px;display:flex;align-items:center;gap:64px;padding:0 90px;box-sizing:border-box;
    background:linear-gradient(135deg,#0E1216 0%,#161B21 60%,#12261F 100%);color:#E5EAF0;font-family:Vazirmatn,sans-serif}
  img{width:260px;height:260px;flex:none;filter:drop-shadow(0 18px 40px rgba(0,0,0,.45))}
  h1{margin:0;font-size:56px;line-height:1.15;font-weight:800;letter-spacing:-.01em}
  h1 span{color:#95A2AF;font-weight:500}
  p{margin:26px 0 0;font-size:30px;line-height:1.4;color:#B4C0CC}
  code{font-family:"JetBrains Mono",monospace;color:#3CC48E;font-size:27px}
</style>
<img src="${dataUrl(svg)}">
<div><h1>Lottie <span>→</span><br>AnimatedVectorDrawable</h1>
<p>Convert Lottie JSON to Android <code>res/drawable</code> XML, right in the browser.</p></div>`);
await page.evaluate(() => document.fonts.ready);
fs.writeFileSync(path.join(DIR, 'og-image.png'), await page.screenshot());

await browser.close();
console.log('icons written to', path.relative(ROOT, DIR));
