// تحميل نص القرآن وأدوات التعامل مع الآيات والكلمات

let SURAHS = null;          // [{ name, type, ayahs: [text] }]
let OFFSETS = null;         // الفهرس العام لأول آية في كل سورة
let TOTAL = 0;              // 6236
const wordCache = new Map();

export async function loadQuran() {
  if (SURAHS) return;
  const res = await fetch('data/quran.json');
  if (!res.ok) throw new Error('تعذر تحميل نص القرآن');
  const data = await res.json();
  SURAHS = data.surahs.map(([name, type, ayahs]) => ({ name, type, ayahs }));
  OFFSETS = [];
  let acc = 0;
  for (const s of SURAHS) { OFFSETS.push(acc); acc += s.ayahs.length; }
  TOTAL = acc;
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
  const words = ayahText(g).split(/\s+/).filter(Boolean).map((text) => ({
    text,
    forms: uthmaniForms(text),
  }));
  wordCache.set(g, words);
  return words;
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
  const threshold = len <= 2 ? 1 : len <= 3 ? 0.66 : 0.7;
  return best >= threshold;
}

export function joinedWord(w1, w2) {
  return { text: `${w1.text} ${w2.text}`, forms: w1.forms.flatMap((a) => w2.forms.map((b) => a + b)) };
}
