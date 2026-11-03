// عرض الآيات في صفحات مصحف المدينة: نفس الصفحة ونفس السطر ونفس بداية ونهاية كل سطر
// والتفسير الميسر

import {
  ayahWords, ayahPage, ayahText, fromGlobal, surahName, toArabicDigits as ar,
  pageAyahs, ayahLineSegs, pageHeads, hasPageLines, letterClusters, juzOf, PAGES, pageShortLines,
} from './quran.js';

const VIEW_KEY = 'mushaf-view';

// طريقة العرض: صفحات المصحف أو نص متصل (لكل جهاز)
export function getView() {
  if (!hasPageLines()) return 'flow';
  try { return localStorage.getItem(VIEW_KEY) === 'flow' ? 'flow' : 'pages'; } catch { return 'pages'; }
}

export function setView(v) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* التخزين غير متاح */ }
}

// ---------- شكل المصحف: المطبوع، أو نص عادي، أو ملوّن بالتجويد ----------
// print: رسم المصحف المطبوع (خط صفحات المجمع QCF4) في عرض الصفحات؛ plain: نص بخط المجمع؛ tajweed: نص ملوّن بالأحكام
const COLOR_KEY = 'mushaf-color';
export function getColorMode() {
  try { const m = localStorage.getItem(COLOR_KEY); return m === 'tajweed' || m === 'plain' ? m : 'print'; } catch { return 'print'; }
}
export function setColorMode(m) {
  try { localStorage.setItem(COLOR_KEY, m); } catch { /* التخزين غير متاح */ }
}

// مجموعات الألوان (على طريقة مصاحف التجويد المطبوعة): الحكم ← المجموعة
const GROUP = {
  madda_necessary: 'madd6', madda_obligatory: 'madd45', madda_permissible: 'madd246', madda_normal: 'madd2',
  ghunnah: 'ghunna', ikhafa: 'ghunna', ikhafa_shafawi: 'ghunna', idgham_ghunnah: 'ghunna', idgham_shafawi: 'ghunna', iqlab: 'ghunna',
  qalaqah: 'qalqala',
  ham_wasl: 'silent', laam_shamsiyah: 'silent', slnt: 'silent',
  idgham_wo_ghunnah: 'silent', idgham_mutajanisayn: 'silent', idgham_mutaqaribayn: 'silent',
};
export const TAJWEED_LEGEND = [
  ['madd6', 'مد لازم ٦ حركات'],
  ['madd45', 'مد واجب ٤ أو ٥ حركات'],
  ['madd246', 'مد جائز ٢ أو ٤ أو ٦'],
  ['madd2', 'مد طبيعي حركتان'],
  ['ghunna', 'غنة وإخفاء وإدغام بغنة وإقلاب'],
  ['qalqala', 'قلقلة'],
  ['silent', 'لا يُنطق (همزة الوصل، اللام الشمسية، الإدغام بلا غنة)'],
];

let tajweed = null;
let tajweedLoad = null;
export function loadTajweed() {
  tajweedLoad ||= fetch('data/tajweed.json')
    .then((r) => { if (!r.ok) throw new Error('tajweed'); return r.json(); })
    .then((d) => { tajweed = { groups: d.rules.map((r) => GROUP[r]), ayahs: d.ayahs }; return true; })
    .catch((e) => { tajweedLoad = null; throw e; });
  return tajweedLoad;
}
export const tajweedReady = () => !!tajweed;

// ---------- رسم المصحف المطبوع (QCF4) ----------
// لكل صفحة: رمز كل كلمة ورقم كل آية في خط صفحتها (data/qcf/NNN.json يبنيه tools/build-qcf4.mjs).
// الخطوط: QCF4 (طبعة المدينة ١٤٤١، خط عثمان طه، مجمع الملك فهد) من حزمة quran-qcf4 على jsDelivr — لا ننسخها عندنا.
// لحد ما يجهز الخط (أو بدون إنترنت أول مرة) تظهر الصفحة بالنص العادي، ثم تُرسم من جديد.
const QCF_FONT_URL = (font) => `https://cdn.jsdelivr.net/npm/quran-qcf4@1.1.0/fonts-woff2/${font}_W.woff2`;
const qcfData = new Map();   // صفحة → بياناتها
const qcfFonts = new Map();  // اسم الخط → وعد تحميله
const qcfOk = new Set();     // خطوط جاهزة
let qcfFailedAt = 0;
let qcfPage = null;          // بيانات الصفحة اللي بتترسم دلوقتي (renderPages)

export const usePrint = () => getColorMode() === 'print' && typeof FontFace !== 'undefined';
const qcfReady = (p) => { const d = qcfData.get(p); return !!d && qcfOk.has(d.font); };

function loadQcfFont(font) {
  if (!qcfFonts.has(font)) {
    const face = new FontFace(font, `url(${QCF_FONT_URL(font)}) format('woff2')`, { display: 'block' });
    qcfFonts.set(font, face.load().then((f) => { document.fonts.add(f); qcfOk.add(font); })
      .catch((e) => { qcfFonts.delete(font); throw e; }));
  }
  return qcfFonts.get(font);
}
async function loadQcfPage(p) {
  if (!qcfData.has(p)) {
    const r = await fetch(`data/qcf/${String(p).padStart(3, '0')}.json`);
    if (!r.ok) throw new Error('qcf');
    qcfData.set(p, await r.json());
  }
  await loadQcfFont(qcfData.get(p).font);
}

// يجهّز رسم الصفحات؛ لما يجهز وفي صفحات كانت بالنص العادي ينادي redraw (مرة واحدة)
export function whenPrintReady(pages, redraw) {
  if (!usePrint()) return;
  const missing = pages.filter((p) => !qcfReady(p));
  if (!missing.length || Date.now() - qcfFailedAt < 30000) return;
  Promise.all(missing.map(loadQcfPage)).then(() => { if (usePrint()) redraw(); }, () => { qcfFailedAt = Date.now(); });
}
// تحميل مسبق (الصفحة اللي بعدها مثلاً) بدون إعادة رسم
export function prefetchPrint(pages) {
  if (usePrint()) pages.filter((p) => p >= 1 && p <= PAGES).forEach((p) => loadQcfPage(p).catch(() => {}));
}

// رقم الآية: رمزه في خط الصفحة المطبوعة، أو الرقم
export function ayahNumber(g) {
  return qcfPage?.e?.[g] ?? ar(fromGlobal(g).a);
}

// محتوى الكلمة: رمزها في خط الصفحة المطبوعة، أو نصها، أو حروفها ملونة بأحكام التجويد في وضع التجويد
export function wordInner(w, g, k) {
  const glyph = qcfPage?.w?.[g]?.[k];
  if (glyph != null) return glyph;
  if (!tajweed || getColorMode() !== 'tajweed') return w.text;
  const codes = tajweed.ayahs[g]?.[k];
  if (!codes) return w.text;
  const letters = letterClusters(w.text);
  if (letters.length !== codes.length) return w.text;
  let html = '';
  let run = '';
  let group = null;
  const flush = () => { if (run) html += group ? `<span class="tj tj-${group}">${run}</span>` : run; run = ''; };
  letters.forEach((ch, i) => {
    const c = codes[i];
    const gr = c === '0' ? null : tajweed.groups[c.charCodeAt(0) - 97] || null;
    if (gr !== group) { flush(); group = gr; }
    run += ch;
  });
  flush();
  return html;
}

export function tajweedLegendHtml() {
  return `<ul class="tj-legend">${TAJWEED_LEGEND.map(([g, label]) => `<li><span class="tj-dot tj-bg-${g}"></span>${label}</li>`).join('')}</ul>`;
}

// صفحات الآيات بترتيب ظهورها
export function pagesOf(ayahs) {
  const out = [];
  for (const g of ayahs) {
    const p = ayahPage(g);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * صفحات المصحف التي فيها الآيات
 * ayahs: الآيات المطلوبة (كلماتها مرقمة بالترتيب كما في wordsOf)
 * word(i, word, g, k): كلمة من الآيات المطلوبة — i رقمها في المقطع، k رقمها في الآية
 * ctx(word, g, k): كلمة من باقي الصفحة (للسياق)
 * marker(g): رقم الآية
 */
export function renderPages(ayahs, { word, ctx = (w, g, k) => `<span class="cw">${wordInner(w, g, k)}</span>`, marker = defaultMarker }) {
  const start = new Map();
  let n = 0;
  for (const g of ayahs) { start.set(g, n); n += ayahWords(g).length; }

  let html = '';
  for (const p of pagesOf(ayahs)) {
    qcfPage = usePrint() && qcfReady(p) ? qcfData.get(p) : null;
    const lines = Array.from({ length: 16 }, () => []);
    const kinds = [];
    for (const [l, type, s] of pageHeads(p)) {
      kinds[l] = type === 0 ? 'head' : 'basmala';
      lines[l].push(type === 0 ? `<span class="surah-title">سورة ${surahName(s)}</span>` : `<span class="basmala-text">${basmala()}</span>`);
    }
    for (const g of pageAyahs(p)) {
      const words = ayahWords(g);
      const base = start.get(g);
      const segs = ayahLineSegs(g);
      let k = 0;
      segs.forEach(([l, count], si) => {
        for (let c = 0; c < count && k < words.length; c++, k++) {
          lines[l].push(base != null ? word(base + k, words[k], g, k) : ctx(words[k], g, k));
        }
        if (si === segs.length - 1) {
          while (k < words.length) { lines[l].push(base != null ? word(base + k, words[k], g, k) : ctx(words[k], g, k)); k++; }
          lines[l].push(marker(g, base != null));
        }
      });
    }
    const last = lines.findLastIndex((x) => x.length);
    const centered = p <= 2;
    const short = pageShortLines(p);
    const first = pageAyahs(p)[0];
    const print = qcfPage ? ` qcf" style="font-family:'${qcfPage.font}'` : '';
    html += `<section class="page${centered ? ' centered' : ''}${print}" data-page="${p}" aria-label="صفحة ${ar(p)}">`;
    // رأس الصفحة (يظهر في ملء الشاشة): اسم السورة والجزء كالمصحف المطبوع
    html += `<header class="page-top" aria-hidden="true"><span>${surahName(fromGlobal(first).s)}</span><span>الجزء ${ar(juzOf(first))}</span></header><div class="lines">`;
    for (let l = 1; l <= (centered ? last : 15); l++) {
      const kind = kinds[l] || (short.includes(l) ? 'short' : '');
      html += `<div class="ln${kind ? ` ${kind}` : ''}">${lines[l].join(' ')}</div>`;
    }
    html += `</div><footer class="page-no">${ar(p)}</footer></section>`;
  }
  qcfPage = null;
  return html;
}

function defaultMarker(g) {
  const { a } = fromGlobal(g);
  return `<button type="button" class="ayah-end" data-ayah="${g}" aria-label="الآية ${ar(a)} — التفسير">${ayahNumber(g)}</button>`;
}

const basmala = () => ayahText(0);

// حجم خط موحد لكل الصفحات بحيث يتسع أطول سطر لعرض الشاشة
// ملء الشاشة (root.full): الصفحة بطول الشاشة، والأسطر الخمسة عشر موزعة على ارتفاعها
const MAX_FONT = 30;
const MAX_FONT_FULL = 48;
const LINES = 15;
export function fitPages(root) {
  const pages = [...root.querySelectorAll('.page')];
  if (!pages.length) return;
  const full = root.classList.contains('full');
  const max = full ? MAX_FONT_FULL : MAX_FONT;
  let size = max;
  for (const page of pages) {
    page.style.fontSize = `${max}px`;
    page.classList.add('measuring');
    const avail = page.querySelector('.lines').clientWidth;
    let widest = 0;
    for (const ln of page.querySelectorAll('.ln:not(.head):not(.basmala)')) widest = Math.max(widest, ln.scrollWidth);
    page.classList.remove('measuring');
    if (widest > 0 && avail > 0) size = Math.min(size, (max * avail) / widest);
    if (full) {
      // ارتفاع السطر = ارتفاع الشاشة المتاح ÷ ١٥، والخط لا يزيد عن ارتفاع السطر
      const lh = page.querySelector('.lines').clientHeight / LINES;
      page.style.setProperty('--lh', `${lh}px`);
      size = Math.min(size, lh / 1.45);
    } else page.style.removeProperty('--lh');
  }
  size = Math.max(10, Math.floor(size * 0.985 * 10) / 10);
  for (const page of pages) page.style.fontSize = `${size}px`;
}

// يعيد الضبط عند تغيير حجم الشاشة وبعد تحميل الخط؛ يُرجع دالة الإلغاء
export function autoFit(root) {
  let frame = 0;
  const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => fitPages(root)); };
  run();
  // خط المصحف يبدأ تحميله أول ما يظهر نص به، فنعيد الضبط بعد اكتماله
  const fonts = document.fonts;
  fonts?.load?.(`20px ${getComputedStyle(root).fontFamily}`, 'بسم').then(run, () => {});
  fonts?.addEventListener?.('loadingdone', run);
  // نعيد الضبط عند تغيّر العرض فقط (تغيير حجم الخط يغيّر الارتفاع)، وفي ملء الشاشة عند تغيّر الارتفاع كمان
  let width = root.clientWidth;
  let height = root.clientHeight;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const full = root.classList.contains('full');
    if (root.clientWidth !== width || (full && root.clientHeight !== height)) { width = root.clientWidth; height = root.clientHeight; run(); }
  }) : null;
  ro?.observe(root);
  const stop = () => { ro?.disconnect(); fonts?.removeEventListener?.('loadingdone', run); cancelAnimationFrame(frame); };
  stop.refit = run; // إعادة الضبط يدوياً (مثلاً عند الدخول لملء الشاشة)
  return stop;
}

// ---------- التفسير الميسر ----------
const tafsirCache = new Map();

async function loadTafsir(s) {
  if (!tafsirCache.has(s)) {
    tafsirCache.set(s, fetch(`data/tafsir/${String(s).padStart(3, '0')}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .catch((e) => { tafsirCache.delete(s); throw e; }));
  }
  return tafsirCache.get(s);
}

// { from, to, text } — الميسر يفسر أحياناً عدة آيات معاً
export async function tafsirOf(g) {
  const { s, a } = fromGlobal(g);
  const groups = await loadTafsir(s);
  const hit = groups.find(([from, to]) => a >= from && a <= to);
  return hit ? { s, from: hit[0], to: hit[1], text: hit[2] } : null;
}

// ---------- معاني الكلمات (الميسر في غريب القرآن) ----------
const gharibCache = new Map();

// [{ from, to, phrase, meaning }] لكلمات الآية (from/to أرقام الكلمات من 0)
export async function gharibOf(g) {
  const { s, a } = fromGlobal(g);
  if (!gharibCache.has(s)) {
    gharibCache.set(s, fetch(`data/gharib/${String(s).padStart(3, '0')}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .catch((e) => { gharibCache.delete(s); throw e; }));
  }
  const data = await gharibCache.get(s);
  return (data[a] || []).map(([from, to, phrase, meaning]) => ({ from, to, phrase, meaning }));
}
