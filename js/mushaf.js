// عرض الآيات في صفحات مصحف المدينة: نفس الصفحة ونفس السطر ونفس بداية ونهاية كل سطر
// والتفسير الميسر

import {
  ayahWords, ayahPage, ayahText, fromGlobal, surahName, toArabicDigits as ar,
  pageAyahs, ayahLineSegs, pageHeads, hasPageLines,
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
export function renderPages(ayahs, { word, ctx = (w) => `<span class="cw">${w.text}</span>`, marker = defaultMarker }) {
  const start = new Map();
  let n = 0;
  for (const g of ayahs) { start.set(g, n); n += ayahWords(g).length; }

  let html = '';
  for (const p of pagesOf(ayahs)) {
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
    html += `<section class="page${centered ? ' centered' : ''}" data-page="${p}" aria-label="صفحة ${ar(p)}"><div class="lines">`;
    for (let l = 1; l <= (centered ? last : 15); l++) {
      html += `<div class="ln${kinds[l] ? ` ${kinds[l]}` : ''}">${lines[l].join(' ')}</div>`;
    }
    html += `</div><footer class="page-no">${ar(p)}</footer></section>`;
  }
  return html;
}

function defaultMarker(g) {
  const { a } = fromGlobal(g);
  return `<button type="button" class="ayah-end" data-ayah="${g}" aria-label="الآية ${ar(a)} — التفسير">﴿${ar(a)}﴾</button>`;
}

const basmala = () => ayahText(0);

// حجم خط موحد لكل الصفحات بحيث يتسع أطول سطر لعرض الشاشة
const MAX_FONT = 30;
export function fitPages(root) {
  const pages = [...root.querySelectorAll('.page')];
  if (!pages.length) return;
  let size = MAX_FONT;
  for (const page of pages) {
    page.style.fontSize = `${MAX_FONT}px`;
    page.classList.add('measuring');
    const avail = page.querySelector('.lines').clientWidth;
    let widest = 0;
    for (const ln of page.querySelectorAll('.ln:not(.head):not(.basmala)')) widest = Math.max(widest, ln.scrollWidth);
    page.classList.remove('measuring');
    if (widest > 0 && avail > 0) size = Math.min(size, (MAX_FONT * avail) / widest);
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
  // نعيد الضبط عند تغيّر العرض فقط (تغيير حجم الخط يغيّر الارتفاع)
  let width = root.clientWidth;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    if (root.clientWidth !== width) { width = root.clientWidth; run(); }
  }) : null;
  ro?.observe(root);
  return () => { ro?.disconnect(); fonts?.removeEventListener?.('loadingdone', run); cancelAnimationFrame(frame); };
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
