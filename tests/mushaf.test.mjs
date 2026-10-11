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
