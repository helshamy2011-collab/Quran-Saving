// اختبارات تقسيم الورد حسب أسطر وصفحات مصحف المدينة — تشغيل: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
