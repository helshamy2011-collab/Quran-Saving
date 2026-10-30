// اختبارات تقسيم الورد حسب أسطر وصفحات مصحف المدينة — تشغيل: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// تخزين في الذاكرة بدل localStorage (غير موجود في Node)
const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });

const Q = await import('../js/quran.js');
const P = await import('../js/plan.js');
const S = await import('../js/store.js');
before(() => Q.loadQuran());

const plan = (set) => ({ ...S.getState().settings, ...set });

test('صفحة كاملة = صفحة المصحف الحقيقية', () => {
  const c = P.previewChunk(plan({ startSurah: 2, direction: 'forward', unit: 'page', amount: 1 }));
  assert.equal(Q.describeAyahs(c), 'البقرة ١–٥'); // صفحة ٢ في مصحف المدينة
  assert.equal(Q.describePosition(c), 'صفحة ٢، من السطر ٣ إلى السطر ٨');
  assert.equal(P.projection(plan({ startSurah: 1, direction: 'forward', unit: 'page', amount: 1 })).studyDays, 604);
});

test('الورد بالأسطر يقف عند نهاية آية وقريب من المطلوب في المتوسط', () => {
  for (const amount of [3, 5, 10]) {
    const days = P.projection(plan({ startSurah: 1, direction: 'forward', unit: 'line', amount })).studyDays;
    const avg = 8820 / days; // ٨٨٢٠ سطر آيات في المصحف
    assert.ok(Math.abs(avg - amount) / amount < 0.1, `${amount} سطر → متوسط ${avg.toFixed(2)}`);
  }
});

test('الآية التي تبدأ بعد آية على نفس السطر توصف "من وسط السطر"', () => {
  const g = Q.toGlobal(2, 8);
  assert.ok(Q.startsMidLine(g));
  assert.match(Q.describePosition([g]), /من وسط السطر/);
  assert.ok(!Q.startsMidLine(Q.toGlobal(2, 1)));
});

test('سورة اخترتها تكمّل حفظها: الورد منها لحد ما تخلص، وبعدين تتسجل محفوظة وترجع الخطة', () => {
  const sur = (s) => Array.from({ length: Q.ayahCount(s) }, (_, i) => Q.toGlobal(s, i + 1));
  S.update((x) => {
    x.settings = { ...x.settings, startSurah: 1, direction: 'forward', prior: [], focusSurah: null };
    x.memorized = sur(67).slice(0, 10); // حافظ أول ١٠ من الملك
    x.surahDates = {};
  });
  assert.equal(P.remainingNew()[0], Q.toGlobal(1, 1)); // بدون اختيار: ترتيب الخطة
  P.setFocus(67);
  const rest = P.remainingNew();
  assert.equal(rest[0], Q.toGlobal(67, 11));
  assert.equal(rest.length, 20); // باقي الملك فقط
  assert.deepEqual(P.surahProgress().find((x) => x.s === 67), { s: 67, total: 30, known: 10 });
  // خلّص الملك
  let done;
  S.update((x) => {
    const before = P.completeSet(x);
    x.memorized = [...x.memorized, ...rest];
    done = P.noteCompleted(x, before, '2026-10-30');
  });
  assert.deepEqual(done, [67]);
  assert.equal(S.getState().surahDates[67], '2026-10-30');
  assert.equal(S.getState().settings.focusSurah, null); // رجع للخطة
  assert.equal(P.remainingNew()[0], Q.toGlobal(1, 1));
});
