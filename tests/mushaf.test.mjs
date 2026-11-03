// اختبارات صفحات المصحف والتفسير الميسر — تشغيل: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.fetch = async (p) => {
  try {
    const text = await readFile(new URL(`../${p}`, import.meta.url), 'utf8');
    return { ok: true, json: async () => JSON.parse(text) };
  } catch { return { ok: false }; }
};

const Q = await import('../js/quran.js');
const M = await import('../js/mushaf.js');
before(() => Q.loadQuran());

test('كل كلمة في القرآن لها سطر في صفحتها، والأسطر بالترتيب', () => {
  for (let g = 0; g < Q.totalAyahs(); g++) {
    const segs = Q.ayahLineSegs(g);
    const words = segs.reduce((a, [, c]) => a + c, 0);
    assert.equal(words, Q.ayahWords(g).length, `آية ${g}`);
    const lines = segs.map(([l]) => l);
    assert.ok(lines.every((l, i) => l >= 1 && l <= 15 && (i === 0 || l === lines[i - 1] + 1)), `أسطر آية ${g}: ${lines}`);
  }
});

test('كل صفحة: آياتها متتالية، والصفحات تغطي المصحف كله', () => {
  let next = 0;
  for (let p = 1; p <= Q.PAGES; p++) {
    const list = Q.pageAyahs(p);
    assert.ok(list.length, `صفحة ${p} فارغة`);
    assert.equal(list[0], next);
    next = list.at(-1) + 1;
  }
  assert.equal(next, Q.totalAyahs());
});

test('سورة النبأ في صفحة ٥٨٢: اسم السورة في السطر ١ والبسملة في السطر ٢ وأول آية في السطر ٣', () => {
  const g = Q.toGlobal(78, 1);
  assert.equal(Q.ayahPage(g), 582);
  assert.deepEqual(Q.pageHeads(582), [[1, 0, 78], [2, 1, 78]]);
  assert.deepEqual(Q.ayahLineSegs(g), [[3, 2]]);
  // آية النبأ ٩: كلماتها في السطر ٥ ورقمها في أول السطر ٦ كما في المصحف
  assert.deepEqual(Q.ayahLineSegs(Q.toGlobal(78, 9)), [[5, 3], [6, 0]]);
});

test('صفحة المصحف: الكلمات المطلوبة مرقمة بالترتيب، وباقي الصفحة للسياق', () => {
  const ayahs = [Q.toGlobal(114, 1), Q.toGlobal(114, 2)];
  const html = M.renderPages(ayahs, { word: (i, w) => `<w i="${i}">${w.text}</w>` });
  const idx = [...html.matchAll(/<w i="(\d+)">/g)].map((m) => Number(m[1]));
  assert.deepEqual(idx, [0, 1, 2, 3, 4, 5]);
  assert.equal((html.match(/class="ln/g) || []).length, 15);
  assert.ok(html.includes('class="cw"'));
  assert.ok(html.includes('سورة الناس'));
});

test('التفسير الميسر: آية منفردة، وآيات مفسرة معاً', async () => {
  const t = await M.tafsirOf(Q.toGlobal(112, 3));
  assert.equal(t.text, 'ليس له ولد ولا والد ولا صاحبة.');
  const g = await M.tafsirOf(Q.toGlobal(37, 2));
  assert.deepEqual([g.from, g.to], [1, 4]);
  // مقدمة السورة ليست من الميسر
  const f = await M.tafsirOf(Q.toGlobal(2, 1));
  assert.ok(!f.text.includes('تسمية السورة') && !f.text.includes('[التفسير]'));
});

test('ملفات التفسير تغطي كل آيات القرآن بلا فجوات', async () => {
  for (let s = 1; s <= 114; s++) {
    const groups = JSON.parse(await readFile(new URL(`../data/tafsir/${String(s).padStart(3, '0')}.json`, import.meta.url), 'utf8'));
    let next = 1;
    for (const [from, to, text] of groups) {
      assert.equal(from, next, `سورة ${s}`);
      assert.ok(to >= from && text.length > 5, `سورة ${s} آية ${from}`);
      next = to + 1;
    }
    assert.equal(next - 1, Q.ayahCount(s), `سورة ${s}`);
  }
});

test('تنوين الضم المتتابع بحرف موجود في خط المصحف (بدونه سفاري يقطع الكلمة: «عظيمٞ»)', () => {
  for (let g = 0; g < Q.totalAyahs(); g++) assert.ok(!Q.ayahText(g).includes('ٞ'), `آية ${g}`);
  const w = Q.ayahWords(Q.toGlobal(2, 7)).at(-1);
  assert.equal(w.text, 'عَظِيمٞ'.replace('ٞ', 'ࣱ'));
  assert.equal(Q.normalizeArabic(w.text), 'عظيم');
  assert.equal(Q.quranGlyphs('مَرَضٞ'), 'مَرَضࣱ');
});

test('مصحف التجويد: حروف الكلمة بحركاتها، وألوان أحكامها على نص المصحف نفسه', async () => {
  assert.deepEqual(Q.letterClusters('ٱلرَّحۡمَٰنِ'), ['ٱ', 'ل', 'رَّ', 'حۡ', 'مَٰ', 'نِ']);
  const data = JSON.parse(await readFile(new URL('../data/tajweed.json', import.meta.url), 'utf8'));
  // كل رموز الكلمة بعدد حروفها، ولا تلوين يغيّر النص
  for (const [g, row] of Object.entries(data.ayahs)) {
    const words = Q.ayahWords(Number(g));
    assert.equal(row.length, words.length, `آية ${g}`);
    row.forEach((codes, k) => { if (codes) assert.equal(codes.length, Q.letterClusters(words[k].text).length, `آية ${g} كلمة ${k}`); });
  }
  globalThis.localStorage = { getItem: () => 'tajweed', setItem() {} };
  await M.loadTajweed();
  const w = Q.ayahWords(0)[3]; // ٱلرَّحِيمِ
  const html = M.wordInner(w, 0, 3);
  assert.equal(html.replace(/<[^>]+>/g, ''), w.text);
  assert.ok(html.includes('tj-silent') && html.includes('tj-madd246'), html);
  globalThis.localStorage = { getItem: () => 'plain', setItem() {} };
  assert.equal(M.wordInner(w, 0, 3), w.text);
  delete globalThis.localStorage;
});

test('نص خط مجمع الملك فهد: كل كلمة معروضة هي نفس حروف كلمتنا، وموجودة في الخط', async () => {
  assert.ok(Q.hasKfgqpcText());
  let empty = 0;
  for (let g = 0; g < Q.totalAyahs(); g++) {
    const words = Q.ayahWords(g);
    for (const [k, w] of words.entries()) {
      if (!w.text) { empty++; continue; }
      // الكلمة الفارغة بعدها جزء من نفس الكلمة المطبوعة
      const want = w.forms[0] + (words[k + 1] && !words[k + 1].text ? words[k + 1].forms[0] : '');
      assert.equal(Q.normalizeArabic(w.text.normalize('NFC')).replace(/ /g, ''), want, `آية ${g} كلمة ${k}`);
    }
  }
  // كلمة واحدة فقط يقسمها نصنا وحدها كلمتين: «فَٱدَّٰرَٰءۡتُمۡ» (البقرة ٧٢)
  assert.equal(empty, 1);
  assert.equal(Q.normalizeArabic(Q.ayahWords(Q.toGlobal(2, 72))[3].text.normalize('NFC')), 'فادرتم');
  // الخط نفسه بدون تعديل (ترخيص المجمع يمنع تعديله)
  const { createHash } = await import('node:crypto');
  const font = await readFile(new URL('../fonts/UthmanicHafs-v-3.0.ttf', import.meta.url));
  assert.equal(createHash('sha256').update(font).digest('hex'), '5c47602425fb4190327ab9e1a2e8ed2f53dceaf595d8ccc29ac32b8b209ad398');
});
