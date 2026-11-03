// يبني data/qcf/NNN.json: لكل صفحة رموز خط صفحات المصحف (QCF4، طبعة المدينة ١٤٤١، خط عثمان طه، مجمع الملك فهد)
// لكل كلمة من كلماتنا — حتى تظهر الصفحة بنفس رسم المصحف المطبوع حرفياً.
// المصدر: حزمة quran-qcf4 1.1.0 (بيانات الصفحات: رخصة MIT؛ الخطوط ليست لنا: تُحمَّل وقت العرض من jsDelivr ولا نضعها في المستودع)
// node tools/build-qcf4.mjs <quran-qcf4>/package
// كمان: لو اختلف سطر كلمة عن data/lines.json نصحّحه على المطبوع (مصدران مستقلان يتفقان عليه)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-qcf4.mjs <quran-qcf4>/package'); process.exit(1); }
const key = (t) => Q.normalizeArabic(t.normalize('NFC')).replace(/ /g, '');

const tokens = new Map(); // g → [{char, text, line, quarter}]
const ends = new Map();
const pageFont = [];
for (let p = 1; p <= Q.PAGES; p++) {
  const d = JSON.parse(await readFile(`${dir}/pages/${String(p).padStart(3, '0')}.json`, 'utf8'));
  pageFont[p] = d.font;
  let quarter = '';
  for (const l of d.lines) {
    for (const w of l.words) {
      if (w.type === 'quarter') { quarter += w.char; continue; }
      if (w.type !== 'word' && w.type !== 'end') continue;
      if (w.font !== d.font) throw new Error(`صفحة ${p}: خط ${w.font}`);
      const [s, a] = w.verse_key.split(':').map(Number);
      const g = Q.toGlobal(s, a);
      if (Q.ayahPage(g) !== p) throw new Error(`آية ${g} ليست في صفحة ${p}`);
      if (w.type === 'end') { ends.set(g, w.char); continue; }
      (tokens.get(g) || tokens.set(g, []).get(g)).push({ char: quarter + w.char, text: w.text, line: l.line });
      quarter = '';
    }
  }
}

const pages = Array.from({ length: Q.PAGES + 1 }, () => ({}));
const looseDiff = [];
const lineFix = [];
let resegmented = 0;
for (let g = 0; g < Q.totalAyahs(); g++) {
  const ours = Q.ayahWords(g);
  // علامة السجدة (#1969) رمز مستقل في المصدر: نلحقه بالكلمة قبلها زي نصنا (يَسۡجُدُونَ۩)
  const th = [];
  for (const t of tokens.get(g) || []) {
    if (t.text.startsWith('#')) { th.at(-1).char += t.char; continue; }
    th.push({ ...t, key: key(t.text) });
  }
  if (!ends.has(g)) throw new Error(`آية ${g} بلا رقم`);
  const row = [];
  const lines = [];
  const loose = (t) => t.replace(/[اويىء]/g, '');
  if (th.length === ours.length) {
    // نفس عدد الكلمات: كلمة بكلمة (الإملاء يختلف أحياناً بين النصّين، فنتأكد بالحروف الأساسية)
    th.forEach((t, k) => {
      const a = loose(key(ours[k].text));
      if (a && loose(t.key) !== a) looseDiff.push([g, k, key(ours[k].text), t.key]);
      row.push(t.char); lines.push(t.line);
    });
  } else {
    // تقسيم مختلف (مَا لِيَ = مَالِيَ، فَٱدَّٰرَٰءۡتُمۡ): نجمع الكلمات حتى تتطابق الحروف
    let j = 0;
    let left = '';
    for (const w of ours) {
      const k = loose(key(w.text));
      if (!k || (left && left.startsWith(k))) { left = left.slice(k.length); row.push(''); lines.push(lines.at(-1)); continue; }
      let got = '';
      let chars = '';
      const line = th[j]?.line;
      while (got.length < k.length && j < th.length) { got += loose(th[j].key); chars += th[j].char; j++; }
      if (!got.startsWith(k)) throw new Error(`آية ${g}: ${got} ≠ ${k}`);
      left = got.slice(k.length);
      row.push(chars);
      lines.push(line);
    }
    if (j !== th.length || left) throw new Error(`آية ${g}: بقي ${th.length - j} ${left}`);
  }
  if (th.length !== ours.length) resegmented++;
  // سطر كل كلمة على المطبوع
  const segs = Q.ayahLineSegs(g);
  const ourLines = segs.flatMap(([l, c]) => Array(c).fill(l));
  lines.forEach((l, k) => { if (l !== ourLines[k]) lineFix.push([g, k, ourLines[k], l]); });
  const p = Q.ayahPage(g);
  (pages[p].w ||= {})[g] = row;
  (pages[p].e ||= {})[g] = ends.get(g);
}

await mkdir(new URL('../data/qcf/', import.meta.url), { recursive: true });
for (let p = 1; p <= Q.PAGES; p++) {
  await writeFile(new URL(`../data/qcf/${String(p).padStart(3, '0')}.json`, import.meta.url), JSON.stringify({ font: pageFont[p], ...pages[p] }));
}

// تصحيح أسطر الكلمات المختلفة في data/lines.json و data/layout.json
if (lineFix.length) {
  const linesUrl = new URL('../data/lines.json', import.meta.url);
  const layoutUrl = new URL('../data/layout.json', import.meta.url);
  const L = JSON.parse(await readFile(linesUrl, 'utf8'));
  const Y = JSON.parse(await readFile(layoutUrl, 'utf8'));
  const byAyah = new Map();
  for (const [g, k, , l] of lineFix) (byAyah.get(g) || byAyah.set(g, new Map()).get(g)).set(k, l);
  for (const [g, fix] of byAyah) {
    const flat = [];
    const a = L.ayahs[g];
    for (let i = 0; i < a.length; i += 2) for (let c = 0; c < a[i + 1]; c++) flat.push(a[i]);
    const markerLine = a.length >= 2 && a.at(-1) === 0 ? a.at(-2) : null;
    for (const [k, l] of fix) flat[k] = l;
    const segs = [];
    for (const l of flat) { if (segs.length && segs.at(-2) === l) segs[segs.length - 1]++; else segs.push(l, 1); }
    if (markerLine != null && markerLine !== segs.at(-2)) segs.push(markerLine, 0);
    L.ayahs[g] = segs;
    Y.ayahs[g] = [Y.ayahs[g][0], segs[0], segs.at(-2)];
  }
  L.source += '; word lines checked against the printed page (quran-qcf4 1.1.0)';
  await writeFile(linesUrl, JSON.stringify(L));
  await writeFile(layoutUrl, JSON.stringify(Y));
}
console.log({ pages: Q.PAGES, resegmented, lineFix, looseDiff: looseDiff.length });
for (const x of looseDiff.slice(0, 40)) console.log(JSON.stringify(x));
