// يبني data/imlaei.json: الرسم الإملائي لكل كلمة في المصحف (كما يكتبها التعرف الصوتي غالباً)
// حتى تُقبل كتابة الكلمة نفسها بالإملاء العادي مطابقةً تامة، ولا تُعامل ككلمة مختلفة
// («رأى» = «رَءَا»، «يحيي» = «يُحۡيِۦ»). نحفظ فقط الكلمات التي يختلف رسمها الإملائي عن صيغها الحالية.
//
// المصدر: النص الإملائي (imlaei) من quran.com داخل حزمة alfurqan (MIT، github.com/ariefsn/alquran-ts)
// نقرأ الملف كبيانات (بدون تشغيل كوده): npm pack alfurqan ثم:
// node tools/build-imlaei.mjs <مسار>/package/dist/index.js
import { readFile, writeFile } from 'node:fs/promises';

// نبني من الصيغ الأصلية فقط (بدون الملف اللي بنبنيه)
globalThis.fetch = async (p) => (p.endsWith('imlaei.json') ? { ok: false }
  : { ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const src = process.argv[2];
if (!src) { console.error('usage: node tools/build-imlaei.mjs <alfurqan/dist/index.js>'); process.exit(1); }
const js = await readFile(src, 'utf8');
const start = js.indexOf('var VERSES_IMLAEI = [');
const block = js.slice(start, js.indexOf('\n];', start));
const text = new Map();
for (const m of block.matchAll(/verseKey:\s*"(\d+:\d+)",\s*text:\s*("(?:[^"\\]|\\.)*")/g)) text.set(m[1], JSON.parse(m[2]));
if (text.size !== Q.totalAyahs()) throw new Error(`عدد الآيات ${text.size}`);

const isWord = (w) => /[ء-ي]/.test(w);
const lev = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
const cost = (a, b) => lev(a, b) / Math.max(a.length, b.length, 1);

// محاذاة: كل كلمة عثمانية تقابل ١–٣ كلمات إملائية (يا أيها / يا ابن أم)، أو كلمتان عثمانيتان تقابلان كلمة إملائية
function align(ours, im) {
  const n = ours.length, m = im.length;
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  dp[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (dp[i][j] === INF) continue;
      for (const [di, dj] of [[1, 1], [1, 2], [1, 3], [2, 1]]) {
        if (i + di > n || j + dj > m) continue;
        const a = ours.slice(i, i + di).join('');
        const b = im.slice(j, j + dj).join('');
        const c = dp[i][j] + cost(a, b) + (di + dj > 2 ? 0.05 : 0);
        if (c < dp[i + di][j + dj]) { dp[i + di][j + dj] = c; back[i + di][j + dj] = [di, dj]; }
      }
    }
  }
  const out = [];
  for (let i = n, j = m; i > 0;) {
    const [di, dj] = back[i][j];
    out.unshift({ i: i - di, di, j: j - dj, dj });
    i -= di; j -= dj;
  }
  return out;
}

const forms = {};
let words = 0, added = 0, joinedSpans = 0, far = 0;
for (let g = 0; g < Q.totalAyahs(); g++) {
  const { s, a } = Q.fromGlobal(g);
  const ours = Q.ayahWords(g);
  const im = text.get(`${s}:${a}`).split(/\s+/).filter(isWord).map(Q.normalizeArabic);
  for (const { i, di, j, dj } of align(ours.map((w) => w.forms[0]), im)) {
    if (di !== 1) continue; // كلمتان عثمانيتان = كلمة إملائية: المطابقة الموصولة تتكفل بها
    words++;
    const f = im.slice(j, j + dj).join('');
    const w = ours[i];
    if (w.forms.includes(f)) continue;
    // محاذاة بعيدة جداً = اختلاف تقسيم لا رسم؛ لا نضيفها
    if (cost(w.forms[0], f) > 0.5) { far++; continue; }
    (forms[g] ||= {})[i] = f;
    added++;
    if (dj > 1) joinedSpans++;
  }
}

await writeFile(new URL('../data/imlaei.json', import.meta.url), JSON.stringify({
  source: 'quran.com imlaei text via alfurqan 0.0.3 (MIT, github.com/ariefsn/alquran-ts); normalized with normalizeArabic',
  format: 'forms[globalAyah][wordIndex] = normalized imlaei spelling (only where it differs from the existing forms)',
  forms,
}));
console.log({ words, added, joinedSpans, far });
