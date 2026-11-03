// يبني data/layout.json و data/lines.json على ترتيب أسطر مصحف المدينة الحديث (إصدار مجمع الملك فهد ٣٫٠، نفس نص خط المصحف)
// المصدر: حزمة @quran.ws/text (CC BY 4.0، github.com/quran-ws/quran-text): data/hafs.json (page_starts، line_starts، surah_starts)
// الأسطر هناك أسطر النص فقط؛ اسم السورة والبسملة نضعهما قبل أول سطر في السورة (أو آخر الصفحة السابقة لو الصفحة ممتلئة)
// للمقارنة (اختياري): ملف Madina-1441H.json من quran-madina-html — نقارن مواضع اسم السورة والبسملة فقط
// node tools/build-lines-1441.mjs <hafs.json> [Madina-1441H.json]
import { readFile, writeFile } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const d = JSON.parse(await readFile(process.argv[2], 'utf8'));
const W = d.words.length;
const pageOfWord = new Int32Array(W);
d.page_starts.forEach((s, i) => { const e = d.page_starts[i + 1] ?? W; for (let j = s; j < e; j++) pageOfWord[j] = i + 1; });
const lineOfWord = new Int32Array(W); // رقم سطر النص العام
d.line_starts.forEach((s, i) => { const e = d.line_starts[i + 1] ?? W; for (let j = s; j < e; j++) lineOfWord[j] = i; });
const surahOfWord = new Int32Array(W);
d.surah_starts.forEach((s, i) => { const e = d.surah_starts[i + 1] ?? W; for (let j = s; j < e; j++) surahOfWord[j] = i + 1; });

// كلمة المصدر الأولى لكل كلمة من كلماتنا (نفس مطابقة tools/build-kfgqpc.mjs)
const key = (t) => Q.normalizeArabic(t.normalize('NFC')).replace(/ /g, '');
const firstWord = []; // [g] = [index per our word]
for (let g = 0; g < Q.totalAyahs(); g++) {
  const from = d.ayah_starts[g];
  const to = d.ayah_starts[g + 1] ?? W;
  const ours = Q.ayahWords(g).map((w) => Q.normalizeArabic(w.text.normalize('NFC')).replace(/ /g, '') || null);
  const row = [];
  let j = from;
  for (const k of ours) {
    if (k == null) { row.push(j - 1); continue; } // كلمة فارغة: جزء من الكلمة قبلها
    row.push(j);
    let got = '';
    while (got.length < k.length && j < to) got += key(d.words[j++]);
    if (got !== k) throw new Error(`آية ${g}: ${got} ≠ ${k}`);
  }
  if (j !== to) throw new Error(`آية ${g}: بقيت كلمات`);
  firstWord.push(row);
}

// صفوف كل صفحة: أسطر النص، وقبل أول سطر في كل سورة اسمها والبسملة (إلا الفاتحة: البسملة آية، والتوبة: بلا بسملة)
const pages = Array.from({ length: 605 }, () => []);
for (let i = 0; i < d.line_starts.length; i++) {
  const s0 = d.line_starts[i];
  const p = pageOfWord[s0];
  const sura = surahOfWord[s0];
  if (d.surah_starts[sura - 1] === s0) {
    pages[p].push({ head: 0, sura });
    if (sura !== 1 && sura !== 9) pages[p].push({ head: 1, sura });
  }
  pages[p].push({ text: i });
}
// صفحتا الفاتحة وأول البقرة أقصر (في الوسط)؛ باقي الصفحات ١٥ سطراً بالضبط
const cap = (p) => (p <= 2 ? pages[p].length : 15);
for (let p = 2; p <= 604; p++) {
  while (pages[p].length > cap(p)) {
    const first = pages[p][0];
    if (first.text != null) throw new Error(`صفحة ${p}: ${pages[p].length} سطر`);
    pages[p].shift();
    pages[p - 1].push(first); // اسم السورة/البسملة في آخر الصفحة السابقة
  }
}
for (let p = 1; p <= 604; p++) if (pages[p].length !== cap(p)) throw new Error(`صفحة ${p}: ${pages[p].length} سطر`);

// رقم سطر كل سطر نص في صفحته، والعناوين
const lineNo = new Map();
const heads = {};
for (let p = 1; p <= 604; p++) {
  pages[p].forEach((r, i) => {
    if (r.text != null) lineNo.set(r.text, [p, i + 1]);
    else (heads[p] ||= []).push([i + 1, r.head, r.sura]);
  });
}

const layout = [];
const ayahs = [];
for (let g = 0; g < Q.totalAyahs(); g++) {
  const segs = [];
  let page = null;
  for (const j of firstWord[g]) {
    const [p, l] = lineNo.get(lineOfWord[j]);
    if (page == null) page = p;
    if (p !== page) throw new Error(`آية ${g} في صفحتين`);
    if (segs.length && segs.at(-2) === l) segs[segs.length - 1]++;
    else segs.push(l, 1);
  }
  ayahs.push(segs);
  layout.push([page, segs[0], segs.at(-2)]);
}

// مقارنة مواضع اسم السورة والبسملة بمصدر ثانٍ مستقل، ومنه الأسطر القصيرة (في وسط السطر في المطبوع)
// السطر قصير لو عرضه أقل من ٩٠٪ من عرض الصفحة (الـ١٧ سطراً دول نفسهم اللي عرض رموزها في خط الصفحات المطبوعة أقل من ٩٠٪)
const short = {};
if (process.argv[3]) {
  const m = JSON.parse(await readFile(process.argv[3], 'utf8'));
  m.lines.forEach((lines, i) => {
    if (i < 2) return; // أول صفحتين في الوسط كلهم
    lines.forEach((x, k) => { if (x.k === 'text' && x.w < 0.9 * m.line_width) (short[i + 1] ||= []).push(k + 1); });
  });
  let diff = 0;
  m.lines.forEach((lines, i) => {
    const p = i + 1;
    const theirs = lines.map((x, k) => (x.k === 'sura' ? `${k + 1}:0` : x.k === 'bism' ? `${k + 1}:1` : null)).filter(Boolean).join(' ');
    const ours = (heads[p] || []).map(([l, t]) => `${l}:${t}`).join(' ');
    const n = lines.length;
    if (theirs !== ours || n !== pages[p].length) { diff++; console.log('اختلاف صفحة', p, { ours, theirs, lines: [pages[p].length, n] }); }
  });
  console.log({ pagesCompared: m.lines.length, headDiff: diff });
}

const src = 'Madani Mushaf, new print (KFGQPC Uthmanic Hafs v3.0) via @quran.ws/text 0.1.0 data/hafs.json (CC BY 4.0, github.com/quran-ws/quran-text); surah titles/basmala placed before each surah\'s first line';
await writeFile(new URL('../data/layout.json', import.meta.url), JSON.stringify({ source: src, format: 'per ayah in mushaf order: [page, firstLine, lastLine]', ayahs: layout }));
await writeFile(new URL('../data/lines.json', import.meta.url), JSON.stringify({
  source: src,
  format: 'ayahs[g] = [line, wordCount, line, wordCount, …] (page from layout.json); heads[page] = [[line, 0 surah title | 1 basmala, surah]]; short[page] = [lines centred in print]',
  ayahs, heads, short,
}));
console.log({ ayahs: ayahs.length, pages: 604, headPages: Object.keys(heads).length });
