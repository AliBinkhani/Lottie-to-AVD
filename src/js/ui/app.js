/** UI wiring: input, preview playback, output and language switching. */
import { clamp } from '../core/math.js';
import { convert, isLottie } from '../converter/converter.js';
import { AVDPlayer } from '../player/avd-player.js';
import { t, num, getLang, setLang, detectLang, onLangChange } from '../i18n/i18n.js';
import { downloadText, copyText } from './download.js';

const $ = s => document.querySelector(s);
const SAMPLE_URL = 'samples/sample.json';

const state = {
  json: null, res: null, frame: 0, total: 0, fr: 30, ip: 0,
  playing: false, speed: 1, loop: true, anim: null, last: 0,
  error: null, // { key, args } — kept so it can be re-translated
  overlay: false,
};
const player = new AVDPlayer($('#avdBox'));
const overlayPlayer = new AVDPlayer($('#overlayBox'));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- small helpers ---------- */

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function renderError() {
  const e = $('#err');
  if (!state.error) { e.classList.add('hidden'); return; }
  e.textContent = t('errors.' + state.error.key, ...(state.error.args || []));
  e.classList.remove('hidden');
}
function showErr(key, ...args) {
  state.error = key ? { key, args } : null;
  renderError();
}
/** Shows an error thrown by the converter/player (which carry a `code`). */
function showException(e) {
  console.error(e);
  if (e && e.code) showErr(e.code, e.detail);
  else showErr('generic', (e && e.message) || String(e));
}

function resName() {
  let n = ($('#resName').value || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (n && !/^[a-z]/.test(n)) n = 'avd_' + n;
  return n || 'avd_animation';
}

/* ---------- localized rendering ---------- */

function renderOptions() {
  $('#prec').querySelectorAll('option').forEach(o => { o.textContent = t('input.digits', num(+o.value)); });
  $('#step').querySelectorAll('option').forEach(o => {
    o.textContent = +o.value === 1 ? t('input.everyFrame') : t('input.everyN', num(+o.value));
  });
  $('#speed').querySelectorAll('option').forEach(o => { o.textContent = num(+o.value) + '×'; });
}

function renderHowto() {
  const n = resName();
  $('#howtoStep1').innerHTML = t('output.step1', n + '.xml');
  $('#kotlin').textContent =
`val avd = AnimatedVectorDrawableCompat.create(context, R.drawable.${n})!!
imageView.setImageDrawable(avd)
avd.registerAnimationCallback(object : Animatable2Compat.AnimationCallback() {
    override fun onAnimationEnd(drawable: Drawable?) {
        imageView.post { avd.start() }   // ${t('output.loopComment')}
    }
})
avd.start()`;
}

function renderPlayButton() {
  const b = $('#play');
  const label = state.playing ? t('preview.pause') : t('preview.play');
  b.textContent = label;
  b.setAttribute('aria-label', label);
}

function renderCaption() {
  $('#capL').textContent = state.overlay ? t('preview.both') : t('preview.lottie');
}

function renderChips() {
  const r = state.res;
  if (!r) { $('#meta').innerHTML = ''; return; }
  const sz = new Blob([r.xml]).size;
  const items = [
    ['meta_chips.size', num(r.W) + '×' + num(r.H)],
    ['meta_chips.fps', num(r.fr)],
    ['meta_chips.duration', t('meta_chips.seconds', num(Math.round((r.op - r.ip) / r.fr * 100) / 100))],
    ['meta_chips.paths', num(r.stats.paths)],
    ['meta_chips.groups', num(r.stats.groups)],
    ['meta_chips.animators', num(r.stats.animators)],
    ['meta_chips.xmlSize', sz > 1024 ? t('meta_chips.kb', num(Math.round(sz / 102.4) / 10)) : t('meta_chips.bytes', num(sz))],
  ];
  const meta = $('#meta');
  meta.innerHTML = '';
  for (const [key, value] of items) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const b = document.createElement('b');
    b.textContent = value;
    chip.append(t(key) + ': ', b);
    meta.appendChild(chip);
  }
}

function renderWarnings() {
  const list = state.res ? state.res.warnings : [];
  const ul = $('#warns');
  ul.innerHTML = '';
  list.forEach(w => {
    const li = document.createElement('li');
    if (w.info) li.className = 'info';
    const params = w.params ? Object.fromEntries(Object.entries(w.params).map(([k, v]) => [k, num(v)])) : {};
    li.textContent = t('warnings.' + w.key, params);
    if (w.count > 1) {
      const s = document.createElement('span');
      s.className = 'n';
      s.textContent = t('report.count', num(w.count));
      li.appendChild(s);
    }
    ul.appendChild(li);
  });
  $('#warnPanel').classList.toggle('hidden', !list.length);
}

function renderFrameLabel(f) {
  $('#frameLbl').textContent = state.json
    ? t('preview.frame', num(Math.floor(f + state.ip)), num(state.total + state.ip))
    : '–';
}

function renderLocalized() {
  renderOptions();
  renderHowto();
  renderPlayButton();
  renderCaption();
  renderChips();
  renderWarnings();
  renderError();
  renderFrameLabel(state.frame);
  if (state.lottieError) $('#emptyL').textContent = t(state.lottieError);
}

/* ---------- conversion & playback ---------- */

function loadPreview(xml) {
  try {
    player.load(xml);
    overlayPlayer.load(xml);
    $('#emptyA').classList.add('hidden');
    return true;
  } catch (e) {
    showException(e);
    return false;
  }
}

function runConvert() {
  if (!state.json) return;
  showErr(null);
  try {
    const r = convert(state.json, { dp: +$('#dp').value, step: +$('#step').value, precision: +$('#prec').value });
    state.res = r;
    $('#xml').value = r.xml;
    renderChips();
    renderWarnings();
    loadPreview(r.xml);
    ['#copy', '#dl', '#apply'].forEach(s => { $(s).disabled = false; });
    draw();
  } catch (e) {
    showException(e);
  }
}

function buildLottie() {
  if (state.anim) { try { state.anim.destroy(); } catch (e) { /* ignore */ } state.anim = null; }
  const box = $('#lottieBox');
  box.innerHTML = '';
  state.lottieError = null;
  const empty = $('#emptyL');
  if (!window.lottie) {
    state.lottieError = 'preview.lottieMissing';
    empty.textContent = t(state.lottieError);
    empty.classList.remove('hidden');
    return;
  }
  try {
    state.anim = window.lottie.loadAnimation({
      container: box, renderer: 'svg', loop: false, autoplay: false,
      animationData: JSON.parse(JSON.stringify(state.json)),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    });
    state.anim.addEventListener('DOMLoaded', draw);
    empty.classList.add('hidden');
  } catch (e) {
    state.lottieError = 'preview.lottieFailed';
    empty.textContent = t(state.lottieError);
    empty.classList.remove('hidden');
  }
}

function setPlaying(p) {
  state.playing = p;
  state.last = 0;
  renderPlayButton();
}

function loadJson(json, fileName) {
  if (!isLottie(json)) { showErr('invalidLottie'); return; }
  state.json = json;
  state.fr = json.fr || 30;
  state.ip = json.ip || 0;
  state.total = Math.max(1, (json.op != null ? json.op : state.ip + state.fr) - state.ip);
  state.frame = 0;
  document.documentElement.style.setProperty('--ar', json.w + ' / ' + json.h);
  if (fileName) {
    $('#resName').value = fileName.replace(/\.json$/i, '');
    $('#resName').value = resName();
  }
  renderHowto();
  $('#scrub').max = String(state.total);
  buildLottie();
  runConvert();
  setPlaying(!reduceMotion);
}

function draw() {
  const f = clamp(state.frame, 0, state.total);
  if (state.anim) {
    try { state.anim.goToAndStop(Math.min(f, state.total - 0.001), true); } catch (e) { /* ignore */ }
  }
  const ms = f / state.fr * 1000;
  player.render(ms);
  if (state.overlay) overlayPlayer.render(ms);
  $('#scrub').value = String(f);
  renderFrameLabel(f);
}

function tick(ts) {
  if (state.playing && state.json) {
    const dt = state.last ? (ts - state.last) / 1000 : 0;
    state.last = ts;
    state.frame += dt * state.fr * state.speed;
    if (state.frame >= state.total) {
      if (state.loop) state.frame %= state.total;
      else { state.frame = state.total; setPlaying(false); }
    }
    draw();
  }
  requestAnimationFrame(tick);
}

function setMode(overlay) {
  state.overlay = overlay;
  $('#stages').classList.toggle('overlay', overlay);
  $('#mSide').setAttribute('aria-pressed', String(!overlay));
  $('#mOver').setAttribute('aria-pressed', String(overlay));
  $('#overNote').classList.toggle('hidden', !overlay);
  renderCaption();
  draw();
}

/* ---------- input ---------- */

function readFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const txt = String(r.result || '');
    if (txt.startsWith('PK')) { showErr('dotLottie'); return; }
    try { loadJson(JSON.parse(txt), file.name); }
    catch (e) { showErr('jsonParse', e.message); }
  };
  r.readAsText(file);
}

async function loadSample() {
  try {
    const res = await fetch(SAMPLE_URL);
    if (!res.ok) throw new Error(res.status);
    loadJson(await res.json(), 'avd_sample.json');
  } catch (e) {
    console.error(e);
    showErr('sampleLoad');
  }
}

/* ---------- events ---------- */

function bindEvents() {
  $('#file').addEventListener('change', e => { readFile(e.target.files[0]); e.target.value = ''; });

  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => readFile(e.dataTransfer && e.dataTransfer.files[0]));

  $('#sample').addEventListener('click', loadSample);
  ['#dp', '#prec', '#step'].forEach(s => $(s).addEventListener('change', runConvert));
  $('#resName').addEventListener('input', renderHowto);

  $('#play').addEventListener('click', () => {
    if (!state.json) return;
    if (!state.playing && state.frame >= state.total) state.frame = 0;
    setPlaying(!state.playing);
  });
  $('#scrub').addEventListener('input', e => { setPlaying(false); state.frame = +e.target.value; draw(); });
  $('#speed').addEventListener('change', e => { state.speed = +e.target.value; });
  $('#loop').addEventListener('change', e => { state.loop = e.target.checked; });
  $('#mSide').addEventListener('click', () => setMode(false));
  $('#mOver').addEventListener('click', () => setMode(true));

  $('#apply').addEventListener('click', () => {
    showErr(null);
    if (loadPreview($('#xml').value)) { draw(); toast(t('toast.previewUpdated')); }
  });
  $('#copy').addEventListener('click', async () => {
    const ok = await copyText($('#xml').value, $('#xml'));
    toast(ok ? t('toast.copied') : t('toast.copyFailed'));
  });
  $('#dl').addEventListener('click', () => {
    downloadText(resName() + '.xml', $('#xml').value);
    toast(t('toast.downloaded'));
  });

  $('#langBtn').addEventListener('click', () => setLang(getLang() === 'en' ? 'fa' : 'en'));
}

/* ---------- boot ---------- */

onLangChange(renderLocalized);
bindEvents();
setLang(detectLang(), { persist: false });
setPlaying(false);
requestAnimationFrame(tick);
