// اختبارات «كمّل الآية» و«ربط الصفحات» ومعاني الكلمات — تشغيل: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window ??= {};
globalThis.fetch = async (p) => {
  try {
    const text = await readFile(new URL(`../${p}`, import.meta.url), 'utf8');
    return { ok: true, json: async () => JSON.parse(text) };
  } catch { return { ok: false }; }
};

const Q = await import('../js/quran.js');
const { Matcher, STATUS } = await import('../js/matcher.js');
const Z = await import('../js/quiz.js');
const M = await import('../js/mushaf.js');
const { wordsOf } = await import('../js/recitation.js');
before(() => Q.loadQuran());

let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const surah = (s) => Array.from({ length: Q.ayahCount(s) }, (_, i) => Q.toGlobal(s, i + 1));

test('كمّل الآية: كلمة للآية القصيرة وحتى ٣ للطويلة، ونصف الآية على الأقل يبقى للتسميع', () => {
  assert.equal(Z.givenCount(2), 1);
  assert.equal(Z.givenCount(5), 2);
  assert.equal(Z.givenCount(20), 3);
  for (let n = 2; n < 40; n++) assert.ok(n - Z.givenCount(n) >= Math.ceil(n / 2) - 1);
  const qs = Z.buildContinue(surah(78), 10, rand);
  assert.equal(qs.length, 10);
  assert.equal(new Set(qs.map((q) => q.ayahs[0])).size, 10);
  assert.ok(qs.every((q) => Q.fromGlobal(q.ayahs[0]).s === 78));
});

test('ربط الصفحات: آخر آية في صفحة وأول آية في التالية، والاثنتان من المقطع', () => {
  const qs = Z.buildLink(surah(2), 100, rand);
  assert.ok(qs.length >= 40);
  for (const q of qs) {
    const [a, b] = q.ayahs;
    assert.equal(Q.ayahPage(a), q.page);
    assert.equal(Q.ayahPage(b), q.page + 1);
    assert.equal(b, a + 1);
    assert.equal(q.given, Q.ayahWords(a).length);
  }
  // سورة في صفحة واحدة: مفيش ربط
  assert.equal(Z.buildLink(surah(112), 10, rand).length, 0);
});

test('الكلمات المعطاة لا تُحسب في النتيجة، والمطابقة تبدأ بعدها', () => {
  const g = Q.toGlobal(112, 1); // قل هو الله أحد
  const m = new Matcher(wordsOf([g]));
  m.give(2);
  assert.deepEqual(m.score(), { total: 2, done: 0, mistakes: 0, accuracy: 0 });
  m.feedFinal('قل هو الله أحد'.split(' ')); // يعيد البداية ثم يكمل
  assert.ok(m.done);
  assert.deepEqual(m.status, [STATUS.GIVEN, STATUS.GIVEN, STATUS.OK, STATUS.OK]);
  assert.equal(m.score().accuracy, 100);
  m.toggle(0);
  assert.equal(m.status[0], STATUS.GIVEN);
});

test('ربط الصفحات: آخر آية معطاة كاملة وأول آية في الصفحة التالية تُسمَّع', () => {
  const [q] = Z.buildLink(surah(78), 1, rand);
  const m = new Matcher(wordsOf(q.ayahs));
  m.give(q.given);
  const target = Q.ayahWords(q.ayahs[1]).map((w) => w.text);
  m.feedFinal(target.map((t) => Q.normalizeArabic(t)));
  assert.ok(m.done, m.status.join(','));
  assert.equal(m.score().mistakes, 0);
  assert.equal(m.score().total, target.length);
});

test('معاني الكلمات: كل كلمة في العبارة تشير لمعناها', async () => {
  const list = await M.gharibOf(Q.toGlobal(78, 2)); // عن النبإ العظيم
  const hit = list.find((x) => 1 >= x.from && 1 <= x.to);
  assert.ok(hit.meaning.includes('الخبر'));
  assert.deepEqual([hit.from, hit.to], [1, 2]);
  assert.deepEqual(await M.gharibOf(Q.toGlobal(1, 3)), []); // آية بلا كلمات غريبة
});

test('ملفات معاني الكلمات: المواضع داخل حدود الآية ومرتبة', async () => {
  let n = 0;
  for (let s = 1; s <= 114; s++) {
    const d = JSON.parse(await readFile(new URL(`../data/gharib/${String(s).padStart(3, '0')}.json`, import.meta.url), 'utf8'));
    for (const [a, list] of Object.entries(d)) {
      const len = Q.ayahWords(Q.toGlobal(s, Number(a))).length;
      for (const [from, to, phrase, meaning] of list) {
        assert.ok(from >= 0 && to >= from && to < len, `${s}:${a}`);
        assert.ok(phrase && meaning);
        n++;
      }
    }
  }
  assert.ok(n > 11000);
});
