// يبني data/kfgqpc.json: نص المصحف بترميز خط مجمع الملك فهد (KFGQPC HAFS Uthmanic Script v3.0) لكل كلمة من كلماتنا
// العرض فقط: المطابقة الصوتية تبقى على نصنا (data/quran.json) — ونتأكد هنا أن حروف كل كلمة هي نفسها بالضبط
//
// المصدر: حزمة @quran.ws/text (CC BY 4.0، github.com/quran-ws/quran-text): data/hafs.json والخط UthmanicHafs-v-3.0.ttf
// نقرأ الملف كبيانات (بدون تشغيل كوده): npm pack @quran.ws/text ثم:
// node tools/build-kfgqpc.mjs <مسار>/package/data/hafs.json
import { readFile, writeFile } from 'node:fs/promises';

globalThis.fetch = async (p) => (p.endsWith('kfgqpc.json') ? { ok: false }
  : { ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const src = process.argv[2];
if (!src) { console.error('usage: node tools/build-kfgqpc.mjs <@quran.ws/text>/data/hafs.json'); process.exit(1); }
const d = JSON.parse(await readFile(src, 'utf8'));
if (d.ayah_starts.length !== Q.totalAyahs()) throw new Error(`عدد الآيات ${d.ayah_starts.length}`);

// علامات الوقف والسجدة و۞ ليست داخل الكلمات في المصدر: نعيدها كما يطبعها المصحف
const after = new Map();
const before = new Map();
for (const [pos, t] of d.marks) {
  const m = d.mark_types[t];
  const map = m.side === 'before' ? before : after;
  map.set(pos, (map.get(pos) || '') + m.sign);
}
const shown = (i) => `${before.has(i) ? `${before.get(i)} ` : ''}${d.words[i]}${after.get(i) || ''}`;
const key = (t) => Q.normalizeArabic(t.normalize('NFC')).replace(/ /g, '');

const ayahs = [];
let resegmented = 0;
for (let g = 0; g < Q.totalAyahs(); g++) {
  const from = d.ayah_starts[g];
  const to = g + 1 < d.ayah_starts.length ? d.ayah_starts[g + 1] : d.words.length;
  const theirs = [];
  for (let i = from; i < to; i++) theirs.push({ text: shown(i), key: key(d.words[i]) });
  const ours = Q.ayahWords(g).map((w) => key(w.text));
  const row = [];
  if (theirs.length === ours.length) {
    ours.forEach((k, i) => {
      if (k !== theirs[i].key) throw new Error(`آية ${g} كلمة ${i}: ${k} ≠ ${theirs[i].key}`);
      row.push(theirs[i].text);
    });
  } else {
    // تقسيم مختلف (مَا لِيَ = مَالِيَ، فَٱدَّٰرَٰءۡتُمۡ مقسومة عندنا كلمتين): نطابق الحروف المتتالية
    // كلمة عندنا = كلمتان عندهم ← نعرضهما بمسافة؛ كلمتان عندنا = كلمة عندهم ← الكلمة كاملة في الأولى والثانية فارغة
    resegmented++;
    let j = 0;
    let left = ''; // حروف كلمة المصدر التي عُرضت ولم تُستهلك بعد
    for (const k of ours) {
      if (left) {
        if (!left.startsWith(k)) throw new Error(`آية ${g}: ${left} / ${k}`);
        left = left.slice(k.length);
        row.push('');
        continue;
      }
      const parts = [];
      let got = '';
      while (got.length < k.length && j < theirs.length) { parts.push(theirs[j].text); got += theirs[j].key; j++; }
      if (!got.startsWith(k)) throw new Error(`آية ${g}: ${got} / ${k}`);
      left = got.slice(k.length);
      row.push(parts.join(' '));
    }
    if (left || j !== theirs.length) throw new Error(`آية ${g}: بقي ${left}`);
  }
  ayahs.push(row);
}

await writeFile(new URL('../data/kfgqpc.json', import.meta.url), JSON.stringify({
  source: 'KFGQPC Uthmanic Hafs v3.0 text (King Fahd Glorious Quran Printing Complex) via @quran.ws/text 0.1.0 data/hafs.json (CC BY 4.0, github.com/quran-ws/quran-text); waqf/sajdah/hizb marks re-attached as printed',
  font: 'fonts/UthmanicHafs-v-3.0.ttf (KFGQPC HAFS Uthmanic Script v3.0, unmodified; free to use, copy and distribute under the KFGQPC licence)',
  format: 'ayahs[globalAyah][wordIndex] = display text of our word (same letters as data/quran.json; "" where our text splits one printed word in two)',
  ayahs,
}));
console.log({ ayahs: ayahs.length, words: ayahs.flat().length, resegmented });
