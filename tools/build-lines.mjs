// يبني data/lines.json: كل كلمة في أي سطر من صفحة مصحف المدينة (لعرض الآيات في صفحة المصحف الحقيقية)
// المصدر: حزمة quran-madina-html 1.0.1 (ISC) — npm pack quran-madina-html@1.0.1 ثم:
// node tools/build-lines.mjs <مسار>/package/assets/db/Madina05-Uthman-24px
import { readFile, writeFile } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-lines.mjs <Madina05-Uthman-24px dir>'); process.exit(1); }

const rows = [];
for (let j = 1; j <= 30; j++) rows.push(...JSON.parse(await readFile(`${dir}/juz-${String(j).padStart(2, '0')}.json`, 'utf8')).d);
const bySurah = new Map();
for (const r of rows) {
  if (!bySurah.has(r[0])) bySurah.set(r[0], new Map());
  bySurah.get(r[0]).set(r[1], r);
}

const isWord = (w) => /[ء-ي]/.test(w);
const letters = (s) => Q.normalizeArabic(s).replace(/[^ء-ي]/g, '').length;

const ayahs = [];   // لكل آية: [سطر، عدد الكلمات، سطر، عدد…] — عدد ٠ = سطر فيه رقم الآية فقط
const heads = {};   // لكل صفحة: [[سطر، ٠ = اسم السورة | ١ = البسملة، رقم السورة]]
let joined = 0;

for (let s = 1; s <= 114; s++) {
  const ents = [...bySurah.get(s - 1).values()].sort((a, b) => a[1] - b[1]);
  const n = Q.ayahCount(s);
  for (const r of ents.slice(0, ents.length - n)) {
    const seg = r[3][0];
    if (!seg.t.trim()) continue;
    const type = seg.t.startsWith('سورة') ? 0 : 1;
    (heads[r[2]] ||= []).push([seg.l, type, s]);
  }
  ents.slice(ents.length - n).forEach((r, i) => {
    const g = Q.toGlobal(s, i + 1);
    const ours = Q.ayahWords(g);
    const segs = r[3].map((seg) => ({ l: seg.l, words: seg.t.replace(/﴿[^﴾]*﴾/g, '').split(/\s+/).filter(isWord) }));
    let counts = segs.map((x) => x.words.length);
    if (counts.reduce((a, b) => a + b, 0) !== ours.length) {
      // الكلمة مكتوبة متصلة في نسخة ومنفصلة في الأخرى (لوما/لو ما): نقسم حسب موضع الحروف
      joined++;
      const total = segs.reduce((a, x) => a + letters(x.words.join('')), 0);
      const cum = [0];
      for (const w of ours) cum.push(cum.at(-1) + letters(w.text));
      let acc = 0;
      let prev = 0;
      counts = segs.map((x, k) => {
        if (k === segs.length - 1) return ours.length - prev;
        acc += letters(x.words.join(''));
        let best = prev;
        for (let b = prev; b <= ours.length; b++) {
          if (Math.abs(cum[b] / cum.at(-1) - acc / total) < Math.abs(cum[best] / cum.at(-1) - acc / total)) best = b;
        }
        const c = best - prev;
        prev = best;
        return c;
      });
    }
    ayahs.push(segs.flatMap((x, k) => [x.l, counts[k]]));
  });
}

const out = {
  source: 'Madani Mushaf line breaks (King Fahd Complex, 1405H) via quran-madina-html 1.0.1 (ISC, github.com/tarekeldeeb/quran-madina-html)',
  format: 'ayahs[g] = [line, wordCount, line, wordCount, …] (page from layout.json); heads[page] = [[line, 0 surah title | 1 basmala, surah]]',
  ayahs,
  heads,
};
await writeFile(new URL('../data/lines.json', import.meta.url), JSON.stringify(out));
console.log({ ayahs: ayahs.length, pagesWithHeads: Object.keys(heads).length, joined });
