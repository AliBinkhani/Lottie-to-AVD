// Regression tests: converts each case in the browser and checks
//   1. visual match: the app's difference view (Lottie vs AVD preview) must
//      stay below `maxDiff` (mean pixel value, 0 = identical) at each frame;
//   2. size: the animator count must stay below `maxAnimators`;
//   3. warnings: the conversion report must list exactly `warnings`;
//   4. output: the XML must match the golden file in tests/golden/.
//
//   npm test                 run all cases
//   npm test -- holes        run cases whose name contains "holes"
//   npm run test:update      rewrite golden XML files after an intended change
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const GOLDEN = path.join(DIR, 'golden');
const OUT = path.join(DIR, 'output');

const args = process.argv.slice(2);
const update = args.includes('--update');
const filter = args.find(a => !a.startsWith('--'));
const cases = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'))
  .filter(c => !filter || c.name.includes(filter));

/** Mean channel value of a PNG (the difference view), computed in the page. */
async function meanOfPng(page, png) {
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, png.toString('base64'));
}

async function runCase(page, base, c) {
  const problems = [];
  await page.goto(base + 'index.html?lang=en');
  await page.setInputFiles('#file', path.join(ROOT, c.file));
  // Wait for the conversion and the lottie-web player.
  await page.waitForFunction(() => document.querySelector('#xml').value.length > 0 &&
    document.querySelector('#lottieBox svg'), null, { timeout: 60000 });

  const errorText = await page.$eval('#err', e => (e.classList.contains('hidden') ? '' : e.textContent));
  if (errorText) problems.push(`conversion error: ${errorText}`);

  const xml = await page.inputValue('#xml');
  const animators = (xml.match(/<objectAnimator/g) || []).length;
  if (animators > c.maxAnimators) problems.push(`animators ${animators} > ${c.maxAnimators}`);

  // Warnings: compare the report text, without occurrence counts.
  const warnings = (await page.$$eval('#warns li', l => l.map(x => x.firstChild.textContent.trim()))).sort();
  const expected = [...(c.warnings || [])].sort();
  if (JSON.stringify(warnings) !== JSON.stringify(expected)) {
    problems.push(`warnings differ:\n      got      ${JSON.stringify(warnings)}\n      expected ${JSON.stringify(expected)}`);
  }

  // Visual match at each frame in the difference view.
  await page.click('#mOver');
  const diffs = [];
  for (const f of c.frames) {
    await page.fill('#scrub', String(f));
    await page.dispatchEvent('#scrub', 'input');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const png = await page.locator('#stageL').screenshot();
    const mean = await meanOfPng(page, png);
    diffs.push(`f${f}=${mean.toFixed(2)}`);
    if (mean > c.maxDiff) {
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${c.name}-diff-f${f}.png`);
      fs.writeFileSync(file, png);
      problems.push(`frame ${f}: difference ${mean.toFixed(2)} > ${c.maxDiff} (saved ${path.relative(ROOT, file)})`);
    }
  }

  // Golden XML.
  const goldenFile = path.join(GOLDEN, `${c.name}.xml`);
  if (update) {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(goldenFile, xml);
  } else if (!fs.existsSync(goldenFile)) {
    problems.push(`no golden file (run: npm run test:update)`);
  } else {
    const golden = fs.readFileSync(goldenFile, 'utf8');
    if (golden !== xml) {
      const a = golden.split('\n'), b = xml.split('\n');
      const line = a.findIndex((l, i) => l !== b[i]);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${c.name}.xml`), xml);
      problems.push(`XML differs from golden at line ${line + 1}:\n      golden ${(a[line] ?? '').trim()}\n      actual ${(b[line] ?? '').trim()}\n      (full output saved in tests/output/${c.name}.xml)`);
    }
  }

  return { problems, summary: `${animators} animators, diff ${diffs.join(' ')}` };
}

const { url, close } = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

let failed = 0;
for (const c of cases) {
  pageErrors.length = 0;
  let result;
  try {
    result = await runCase(page, url, c);
  } catch (e) {
    result = { problems: [`exception: ${e.message}`], summary: '' };
  }
  if (pageErrors.length) result.problems.push(`page errors: ${pageErrors.join('; ')}`);
  const ok = !result.problems.length;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  (${result.summary})`);
  for (const p of result.problems) console.log(`      - ${p}`);
}

await browser.close();
close();
console.log(`\n${cases.length - failed}/${cases.length} passed${update ? ' (golden files updated)' : ''}`);
process.exit(failed ? 1 : 0);
