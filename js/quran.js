// تحميل نص القرآن وأدوات التعامل مع الآيات والكلمات

let SURAHS = null;          // [{ name, type, ayahs: [text] }]
let OFFSETS = null;         // الفهرس العام لأول آية في كل سورة
let TOTAL = 0;              // 6236
const wordCache = new Map();

let LAYOUT = null;           // لكل آية: [الصفحة، أول سطر، آخر سطر] في مصحف المدينة
let SIMILAR = {};            // المتشابهات: آية → [[آية مشابهة، نسبة التشابه]]

export async function loadQuran() {
  if (SURAHS) return;
  const [res, lay, sim] = await Promise.all([fetch('data/quran.json'), fetch('data/layout.json'), fetch('data/similar.json').catch(() => null)]);
  if (!res.ok || !lay.ok) throw new Error('تعذر تحميل نص القرآن');
  const data = await res.json();
  SURAHS = data.surahs.map(([name, type, ayahs]) => ({ name, type, ayahs }));
  OFFSETS = [];
  let acc = 0;
  for (const s of SURAHS) { OFFSETS.push(acc); acc += s.ayahs.length; }
  TOTAL = acc;
  LAYOUT = (await lay.json()).ayahs;
  try { if (sim?.ok) SIMILAR = (await sim.json()).similar; } catch { SIMILAR = {}; }
}

// ---------- المتشابهات ----------
// الآيات المتشابهة لفظياً مع آية (مرتبة من الأكثر تشابهاً)
export function similarOf(g) {
  return (SIMILAR[g] || []).map(([h, score]) => ({ g: h, score }));
}

// مقارنة آيتين كلمة بكلمة: الكلمات التي تنفرد بها كل آية (ليست في الأجزاء المشتركة بنفس الترتيب)
// محاذاة كلمات آيتين: أزواج الكلمات المشتركة بنفس الترتيب (أطول تتابع مشترك)
function alignAyahs(g, h) {
  const a = ayahWords(g).map((w) => w.forms[0]);
  const b = ayahWords(h).map((w) => w.forms[0]);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < m && j < n;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { m, n, pairs };
}

export function compareAyahs(g, h) {
  const { m, n, pairs } = alignAyahs(g, h);
  const inA = new Set(pairs.map((x) => x[0]));
  const inB = new Set(pairs.map((x) => x[1]));
  return {
    onlyA: [...Array(m).keys()].filter((i) => !inA.has(i)),
    onlyB: [...Array(n).keys()].filter((j) => !inB.has(j)),
    identical: inA.size === m && inB.size === n,
  };
}

// "منافسو" كل كلمة: الكلمات المقابلة لها في الآيات المتشابهة (فكلوا ↔ وكلوا، خطيكم ↔ خطيتكم)
// لو قال المستخدم المنافس بدل الكلمة فهذا خلط بين المتشابهات، لا مجرد اختلاف نطق
const rivalCache = new Map();
export function rivalsOf(g) {
  if (rivalCache.has(g)) return rivalCache.get(g);
  const own = ayahWords(g);
  const rivals = own.map(() => []);
  for (const { g: h } of similarOf(g)) {
    const { m, n, pairs } = alignAyahs(g, h);
    const other = ayahWords(h);
    const anchors = [[-1, -1], ...pairs, [m, n]];
    for (let k = 0; k + 1 < anchors.length; k++) {
      const [i1, j1] = anchors[k];
      const [i2, j2] = anchors[k + 1];
      for (let i = i1 + 1; i < i2; i++) {
        for (let j = j1 + 1; j < j2; j++) {
          const f = other[j].forms[0];
          if (!own[i].forms.includes(f)) rivals[i].push({ form: f, g: h });
        }
      }
    }
  }
  rivalCache.set(g, rivals);
  return rivals;
}

// هل الخطأ في كلمة من الآية g سببه الخلط مع آية متشابهة؟
// heard: ما قاله المستخدم مكان الكلمة (مطبّعاً)، st: نوع الخطأ
// يُرجع الآية المتشابهة لو كان ما قاله من ألفاظها هي، أو لو أسقط كلمة تنفرد بها آيته
export function confusionFor(g, w, heard, st) {
  const said = (heard || '').split(' ').filter(Boolean);
  const own = ayahWords(g)[w];
  for (const r of rivalsOf(g)[w] || []) {
    if (said.some((t) => wordScore(t, { forms: [r.form] }) > wordScore(t, own))) return r.g;
  }
  for (const { g: h } of similarOf(g)) {
    const { onlyA, onlyB, identical } = compareAyahs(g, h);
    if (identical) continue;
    const other = ayahWords(h);
    if (said.some((t) => onlyB.some((j) => wordMatches(t, other[j])))) return h;
    if (st === 'skipped' && onlyA.includes(w)) return h;
  }
  return null;
}

// ---------- مصحف المدينة: الصفحات والأسطر ----------
// ٦٠٤ صفحة × ١٥ سطراً؛ كل صفحة تبدأ ببداية آية
export const LINES_PER_PAGE = 15;
export const ayahPage = (g) => LAYOUT[g][0];
// رقم عام للسطر في المصحف كله (للعدّ)
const globalLine = (page, line) => (page - 1) * LINES_PER_PAGE + (line - 1);

// الأسطر التي تشغلها الآية (أرقام عامة)
export function ayahLines(g) {
  const [p, a, b] = LAYOUT[g];
  const out = [];
  for (let l = a; l <= b; l++) out.push(globalLine(p, l));
  return out;
}

// عدد الأسطر الفعلية التي تشغلها مجموعة آيات (السطر المشترك بين آيتين يُحسب مرة)
export function linesCount(list) {
  const set = new Set();
  for (const g of list) for (const l of ayahLines(g)) set.add(l);
  return set.size;
}

// هل تبدأ الآية في منتصف السطر (بعد نهاية آية قبلها على نفس السطر)؟
export function startsMidLine(g) {
  if (g === 0) return false;
  const [p, a] = LAYOUT[g];
  const [pp, , pb] = LAYOUT[g - 1];
  return pp === p && pb === a;
}

// وصف موضع مجموعة آيات في المصحف: "صفحة ٢، من السطر ٥ إلى السطر ٩"
export function describePosition(list) {
  if (!list.length) return '';
  const sorted = [...list].sort((x, y) => x - y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const [p1, l1] = LAYOUT[first];
  const [p2, , l2] = LAYOUT[last];
  const from = `${startsMidLine(first) ? 'من وسط السطر' : 'من السطر'} ${toArabicDigits(l1)}`;
  if (p1 === p2) return `صفحة ${toArabicDigits(p1)}، ${from} إلى السطر ${toArabicDigits(l2)}`;
  return `صفحة ${toArabicDigits(p1)} ${from} ← صفحة ${toArabicDigits(p2)} السطر ${toArabicDigits(l2)}`;
}

export const surahCount = () => 114;
export const totalAyahs = () => TOTAL;
export const surahName = (s) => SURAHS[s - 1].name;
export const ayahCount = (s) => SURAHS[s - 1].ayahs.length;

// تحويل (سورة، آية) إلى فهرس عام يبدأ من 0 والعكس
export function toGlobal(s, a) { return OFFSETS[s - 1] + (a - 1); }
export function fromGlobal(g) {
  let lo = 0, hi = 113;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (OFFSETS[mid] <= g) lo = mid; else hi = mid - 1;
  }
  return { s: lo + 1, a: g - OFFSETS[lo] + 1 };
}

export function ayahText(g) {
  const { s, a } = fromGlobal(g);
  return SURAHS[s - 1].ayahs[a - 1];
}

// كلمات الآية: النص المعروض + صيغ مطبّعة للمقارنة مع ما يقوله المستخدم
export function ayahWords(g) {
  if (wordCache.has(g)) return wordCache.get(g);
  const { s, a } = fromGlobal(g);
  const words = ayahText(g).split(/\s+/).filter(Boolean).map((text, i) => {
    const word = { text, forms: uthmaniForms(text) };
    if (i === 0 && isMuqattaat(s, a)) addLetterNames(word);
    return word;
  });
  wordCache.set(g, words);
  return words;
}

// ---------- الحروف المقطعة ----------
// تُكتب كلمة واحدة (الٓمٓ) وتُقرأ بأسماء الحروف (ألف لام ميم)، والتعرف الصوتي قد يكتبها
// كلمات منفصلة "الف لام ميم" أو كلمة واحدة "ياسين" أو كما تُكتب "الم"
const MUQATTAAT_SURAHS = new Set([2, 3, 7, 10, 11, 12, 13, 14, 15, 19, 20, 26, 27, 28, 29, 30, 31, 32, 36, 38, 40, 41, 42, 43, 44, 45, 46, 50, 68]);
const LETTER_NAMES = {
  'ا': ['الف'], 'ل': ['لام'], 'م': ['ميم'], 'ص': ['صاد'], 'ر': ['را'], 'ك': ['كاف'], 'ه': ['ها', 'هه'],
  'ي': ['يا'], 'ع': ['عين'], 'ط': ['طا'], 'س': ['سين', 'سن'], 'ح': ['حا'], 'ق': ['قاف'], 'ن': ['نون'],
};

export function isMuqattaat(s, a) {
  return (a === 1 && MUQATTAAT_SURAHS.has(s)) || (s === 42 && a === 2);
}

function addLetterNames(word) {
  const letters = [...normalizeArabic(word.text)];
  if (!letters.every((c) => LETTER_NAMES[c])) return;
  // كل التوليفات الممكنة لأسماء الحروف (عددها صغير)
  let combos = [''];
  for (const c of letters) combos = combos.flatMap((pre) => LETTER_NAMES[c].map((n) => pre + n));
  word.forms = [...new Set([...word.forms, ...combos])];
  word.letters = letters.length; // أقصى عدد كلمات مسموعة قد تُكوّنها
}

export const ayahWordCount = (g) => ayahWords(g).length;

export function surahRangeLabel(s, from, to) {
  if (from === 1 && to === ayahCount(s)) return `سورة ${surahName(s)} كاملة`;
  const [f, t] = [toArabicDigits(from), toArabicDigits(to)];
  return from === to ? `${surahName(s)} ${f}` : `${surahName(s)} ${f}–${t}`;
}

// وصف مختصر لمجموعة آيات (فهارس عامة متتالية أو لا)
export function describeAyahs(list) {
  if (!list.length) return '';
  const groups = [];
  for (const g of list) {
    const { s, a } = fromGlobal(g);
    const last = groups[groups.length - 1];
    if (last && last.s === s && last.to === a - 1) last.to = a;
    else groups.push({ s, from: a, to: a });
  }
  const parts = groups.map((x) => surahRangeLabel(x.s, x.from, x.to));
  return parts.length > 3 ? `${parts.slice(0, 3).join('، ')} و${parts.length - 3} مواضع أخرى` : parts.join('، ');
}

export function toArabicDigits(n) {
  return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
}

// ---------- التطبيع ----------
// علامات التشكيل وعلامات الضبط والوقف في الرسم العثماني
const MARKS = /[ؐ-ًؚ-ٟۖ-ۜ۞-ۭـ]/g;

export function normalizeArabic(text) {
  return text
    .replace(/[ٰ]/g, '')
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/[^ء-ي]/g, '');
}

// الرسم العثماني يختلف عن الإملائي (العلمين/العالمين، الصلوة/الصلاة)
// فنولّد أكثر من صيغة ونقارن بأقربها
function uthmaniForms(word) {
  const forms = new Set();
  forms.add(normalizeArabic(word));
  // الألف الخنجرية تُنطق ألفاً
  forms.add(normalizeArabic(word.replace(/([^ىيو])([ً-ٟ]*)ٰ/g, '$1$2ا')));
  // الصلوة → الصلاة ، الزكوة → الزكاة
  forms.add(normalizeArabic(word.replace(/وٰ/g, 'ا')));
  // "يَٰٓأَيُّهَا" → "يا ايها"
  forms.add(normalizeArabic(word.replace(/^(ي[َ]?)ٰٓ?/, 'يا')));
  // اللام الشمسية لا تُنطق: ٱلنَّاس → "اناس"، ووَٱلنَّاس موصولة → "وناس"
  const shamsi = /ٱل(?=[ء-ي]ّ)/;
  if (shamsi.test(word)) {
    forms.add(normalizeArabic(word.replace(shamsi, 'ا')));
    forms.add(normalizeArabic(word.replace(shamsi, '')));
  }
  forms.delete('');
  return [...forms];
}

// ---------- التشابه ----------
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function sim(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// هل الكلمة المسموعة (مطبّعة) تطابق كلمة المصحف؟
export function wordMatches(heard, word) {
  return wordScore(heard, word) > 0;
}

// درجة التطابق (0 = لا تطابق، وإلا نسبة التشابه) — للمفاضلة بين قراءتين محتملتين
export function wordScore(heard, word) {
  let best = 0;
  for (const f of word.forms) {
    // زيادة أو حذف واو/فاء العطف خطأ حقيقي في الحفظ (واحد ≠ أحد، فلا ≠ لا)
    if (heard.length !== f.length && /^[وف]/.test(heard + f)) {
      const [long, short] = heard.length > f.length ? [heard, f] : [f, heard];
      if (long.length === short.length + 1 && /^[وف]/.test(long) && long.slice(1) === short) continue;
    }
    const s = sim(heard, f);
    if (s > best) best = s;
    // التعرف الصوتي أحياناً يحذف "ال" التعريف
    if (f.length > 4 && f.startsWith('ال') && !heard.startsWith('ال')) {
      best = Math.max(best, sim(heard, f.slice(2)) - 0.1);
    }
  }
  const len = Math.max(heard.length, word.forms[0].length);
  let threshold = len <= 2 ? 1 : len <= 3 ? 0.66 : 0.7;
  // الحروف المقطعة: حرف واحد مختلف = خطأ (ألف لام را ≠ ألف لام ميم)
  if (word.letters) threshold = Math.max(threshold, 0.85);
  return best >= threshold ? best : 0;
}

// ---------- أحكام التجويد بين كلمتين ----------
// التعرف الصوتي يكتب غالباً الكلمات بإملائها العادي مهما كان النطق، لكنه أحياناً يكتب ما سمعه فعلاً:
// إدغام (من ربهم → مربهم)، إقلاب (من بعد → ممبعد)، إدغام التنوين (هدى للمتقين → هدللمتقين).
// الرسم العثماني يحدد هذه المواضع بدقة، فنولّد صيغة النطق الموصول ونقبلها.
const TANWEEN = /[\u064B-\u064D\u0656\u0657\u065E\u08F0-\u08F2]/;
const IQLAB = /\u06E2/;           // ميم صغيرة: إقلاب النون أو التنوين ميماً

// هل أول حرف في الكلمة مشدد؟ (علامة الإدغام في الكلمة التالية) — لا يشمل "ال" الشمسية
function firstLetterDoubled(raw) {
  const m = raw.match(/^([\u0621-\u064A])([\u064B-\u0652\u0656-\u065E\u0670\u06DF-\u06ED]*)/);
  return !!m && m[1] !== '\u0671' && m[2].includes('\u0651');
}

export function tajweedJoins(w1, w2) {
  const a = normalizeArabic(w1.text);
  const b = normalizeArabic(w2.text);
  const out = [];
  if (IQLAB.test(w1.text)) {
    // من بعد → ممبعد ، سميع بصير → سميعمبصير
    out.push((a.endsWith('ن') ? a.slice(0, -1) : a) + 'م' + b);
  }
  if (firstLetterDoubled(w2.text)) {
    if (TANWEEN.test(w1.text)) {
      // هدى للمتقين → هدللمتقين ، خيرا لهم → خيرللهم
      out.push(a.replace(/[اي]$/, '') + b, a + b);
    } else {
      // إدغام الحرف الأخير في أول التالية: من ربهم → مربهم ، قد تبين → قتبين
      out.push(a.slice(0, -1) + b);
    }
  }
  return out;
}

export function joinedWord(w1, w2) {
  const forms = new Set(w1.forms.flatMap((a) => w2.forms.map((b) => a + b)));
  for (const f of tajweedJoins(w1, w2)) forms.add(f);
  forms.delete('');
  return { text: `${w1.text} ${w2.text}`, forms: [...forms] };
}
