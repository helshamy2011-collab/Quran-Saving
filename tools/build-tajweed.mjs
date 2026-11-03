// يبني data/tajweed.json: حكم التجويد لكل حرف (بحركاته) في نص المصحف عندنا
// المصدر: نص quran.com المعلَّم بأحكام التجويد (uthmani_tajweed) داخل حزمة alfurqan (MIT، github.com/ariefsn/alquran-ts)
// نقرأ الملف كبيانات (بدون تشغيل كوده): npm pack alfurqan ثم:
// node tools/build-tajweed.mjs <مسار>/package/dist/index.js
//
// لا نعرض نص المصدر نفسه: ترميزه يختلف عن نصنا (مثلاً U+0672 مكان الألف الصغيرة، وهو غير موجود في خط المصحف)،
// فنُسقط الأحكام على حروف نصنا بمحاذاة الحروف الأساسية لكل كلمة.
import { readFile, writeFile } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const src = process.argv[2];
if (!src) { console.error('usage: node tools/build-tajweed.mjs <alfurqan/dist/index.js>'); process.exit(1); }
const js = await readFile(src, 'utf8');
const start = js.indexOf('var VERSES_UTHMANITAJWEED = [');
const block = js.slice(start, js.indexOf('\n];', start));
const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = new Map();
for (const m of block.matchAll(/verseKey:\s*"(\d+:\d+)",\s*text:\s*("(?:[^"\\]|\\.)*")/g)) text.set(m[1], unescape(JSON.parse(m[2])));
if (text.size !== Q.totalAyahs()) throw new Error(`عدد الآيات ${text.size}`);

// أحكام المصدر ← رمز حرف واحد لكل حكم (الترتيب ثابت؛ js/mushaf.js يستخدم نفس القائمة)
export const RULES = ['ham_wasl', 'laam_shamsiyah', 'slnt', 'madda_normal', 'madda_permissible', 'madda_obligatory', 'madda_necessary',
  'qalaqah', 'ghunnah', 'ikhafa', 'ikhafa_shafawi', 'idgham_ghunnah', 'idgham_shafawi', 'iqlab', 'idgham_wo_ghunnah',
  'idgham_mutajanisayn', 'idgham_mutaqaribayn'];
const code = (rule) => String.fromCharCode(97 + RULES.indexOf(rule)); // a, b, c…

// نص المصدر ← حروف وكل حرف بحكمه
function parse(html) {
  const chars = [];
  const body = html.replace(/<span class=end>[^<]*<\/span>/g, '');
  const re = /<tajweed class=([a-z_]+)>([^<]*)<\/tajweed>|<[^>]*>|([^<]+)/g;
  for (const m of body.matchAll(re)) {
    if (m[1]) for (const ch of m[2]) chars.push({ ch, rule: m[1] });
    else if (m[3]) for (const ch of m[3]) chars.push({ ch, rule: null });
  }
  return chars.filter((c) => c.ch !== '>'); // علامة وسم تالفة في موضع واحد (يونس ٣٨)
}

// تقسيم حروف المصدر لكلمات، والكلمة لحروف بحركاتها — بنفس منطق letterClusters
const MARK = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ‌]/;
function clustersOf(chars) {
  const out = [];
  for (const c of chars) {
    // U+0672 في المصدر = الألف الصغيرة عندنا (علامة تلحق الحرف قبلها)
    const isMark = MARK.test(c.ch) || c.ch === 'ٲ';
    if (isMark && out.length) { const last = out[out.length - 1]; last.text += c.ch; if (c.rule) last.markRules.add(c.rule); }
    else out.push({ text: c.ch, base: c.ch, baseRules: new Set(c.rule ? [c.rule] : []), markRules: new Set() });
  }
  // حكم الحرف: من الحرف نفسه، وإلا من حركاته بشرط ألا يمتد الحكم للحرف التالي
  // («حِي»: المد على الياء لا الحاء؛ «مَٰ»: المد على الألف الصغيرة فيُلوَّن حرفها)
  out.forEach((c, k) => {
    const next = out[k + 1]?.baseRules || new Set();
    c.rules = c.baseRules.size ? c.baseRules : new Set([...c.markRules].filter((r) => !next.has(r)));
  });
  return out;
}
function wordsOfChars(chars) {
  const words = [[]];
  for (const c of chars) { if (/\s/.test(c.ch)) { if (words.at(-1).length) words.push([]); } else words.at(-1).push(c); }
  return words.filter((w) => w.length && w.some((c) => /[ء-يٱٮ]/.test(c.ch)));
}

// الحرف الأساسي بصيغة موحّدة للمحاذاة
const canon = (ch) => ({ 'ٱ': 'ا', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ٮ': 'ي', 'ة': 'ه', 'ؤ': 'و' }[ch] || ch);

// محاذاة (أطول تتابع مشترك) بين حروف كلمتنا وحروف كلمة المصدر
function align(ours, theirs) {
  const a = ours.map((c) => canon(c[0])), b = theirs.map((c) => canon(c.base));
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// حكم واحد للحرف لو اجتمع أكثر من حكم: الأهم للقارئ أولاً
const PRIORITY = ['madda_necessary', 'madda_obligatory', 'madda_permissible', 'madda_normal', 'iqlab', 'ikhafa', 'ikhafa_shafawi',
  'idgham_ghunnah', 'idgham_shafawi', 'ghunnah', 'qalaqah', 'idgham_wo_ghunnah', 'idgham_mutajanisayn', 'idgham_mutaqaribayn',
  'laam_shamsiyah', 'ham_wasl', 'slnt'];
const pick = (rules) => PRIORITY.find((r) => rules.has(r)) || null;

const out = {};
let ayat = 0, skipped = 0, letters = 0, colored = 0, lost = 0;
for (let g = 0; g < Q.totalAyahs(); g++) {
  const { s, a } = Q.fromGlobal(g);
  const theirs = wordsOfChars(parse(text.get(`${s}:${a}`)));
  const ours = Q.ayahWords(g);
  if (theirs.length !== ours.length) { skipped++; continue; } // تقسيم كلمات مختلف (لو ما/لوما…): تبقى بلا تلوين
  ayat++;
  const row = ours.map((w, k) => {
    const oc = Q.letterClusters(w.text);
    const tc = clustersOf(theirs[k]);
    const codes = new Array(oc.length).fill('0');
    for (const [i, j] of align(oc, tc)) { const r = pick(tc[j].rules); if (r) codes[i] = code(r); }
    letters += oc.length;
    const want = tc.filter((c) => c.rules.size).length;
    const got = codes.filter((c) => c !== '0').length;
    colored += got;
    lost += Math.max(0, want - got);
    return codes.includes('0') && codes.every((c) => c === '0') ? '' : codes.join('');
  });
  if (row.some(Boolean)) out[g] = row;
}

await writeFile(new URL('../data/tajweed.json', import.meta.url), JSON.stringify({
  source: 'quran.com uthmani_tajweed via alfurqan 0.0.3 (MIT, github.com/ariefsn/alquran-ts), projected onto our text by letter alignment',
  format: 'ayahs[globalAyah][wordIndex] = one code per letter cluster of the word (letterClusters): "0" none, a… = rules[index]',
  rules: RULES,
  ayahs: out,
}));
console.log({ ayat, skipped, letters, colored, lost });
