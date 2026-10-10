// اختبارات محرك المطابقة — تشغيل: node --test tests/
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });

const Q = await import('../js/quran.js');
const { Matcher, STATUS } = await import('../js/matcher.js');
before(() => Q.loadQuran());

function words(s, from, to) {
  const out = [];
  for (let a = from; a <= to; a++) {
    const g = Q.toGlobal(s, a);
    Q.ayahWords(g).forEach((w, i) => out.push({ ...w, g, w: i }));
  }
  return out;
}
const say = (m, text) => m.feedFinal(text.split(' '));

test('الفاتحة بالإملاء العادي كما يكتبها التعرف الصوتي', () => {
  const m = new Matcher(words(1, 1, 7));
  say(m, 'بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين');
  say(m, 'اياك نعبد واياك نستعين اهدنا الصراط المستقيم صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين');
  assert.ok(m.done);
  assert.equal(m.score().mistakes, 0, m.status.join(','));
});

test('كلمات بالرسم العثماني: الصلاة، الزكاة، يا أيها، ذلك، أولئك', () => {
  const m = new Matcher(words(2, 2, 5));
  say(m, 'ذلك الكتاب لا ريب فيه هدى للمتقين الذين يؤمنون بالغيب ويقيمون الصلاة ومما رزقناهم ينفقون');
  say(m, 'والذين يؤمنون بما أنزل إليك وما أنزل من قبلك وبالآخرة هم يوقنون أولئك على هدى من ربهم وأولئك هم المفلحون');
  assert.ok(m.done);
  assert.equal(m.score().mistakes, 0, m.status.map((s, i) => `${m.words[i].text}:${s}`).join(' '));

  const m2 = new Matcher(words(2, 21, 21));
  say(m2, 'يا أيها الناس اعبدوا ربكم الذي خلقكم والذين من قبلكم لعلكم تتقون');
  assert.ok(m2.done);
  assert.equal(m2.score().mistakes, 0, m2.status.map((s, i) => `${m2.words[i].text}:${s}`).join(' '));
});

test('إسقاط كلمة يُسجَّل كسقط', () => {
  const m = new Matcher(words(112, 1, 4));
  say(m, 'قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له أحد'); // أسقط "كفوا"
  assert.ok(m.done);
  const bad = m.status.map((s, i) => [m.words[i].text, s]).filter(([, s]) => s !== STATUS.OK);
  assert.equal(bad.length, 1);
  assert.equal(bad[0][1], STATUS.SKIPPED);
  assert.match(bad[0][0], /كُفُو/);
});

test('كلمة خاطئة مكان كلمة صحيحة تُسجّل خطأ', () => {
  const m = new Matcher(words(112, 1, 2));
  say(m, 'قل هو الله واحد الله الصمد');
  assert.ok(m.done);
  assert.deepEqual(m.status, [STATUS.OK, STATUS.OK, STATUS.OK, STATUS.WRONG, STATUS.OK, STATUS.OK]);
});

test('تكرار الكلمات السابقة لا يُعد خطأ', () => {
  const m = new Matcher(words(112, 1, 2));
  say(m, 'قل هو الله أحد الله أحد الله الصمد');
  assert.equal(m.score().mistakes, 0);
  assert.ok(m.done);
});

test('النتائج المؤقتة تكشف المطابق فقط ولا تسجل أخطاء', () => {
  const m = new Matcher(words(112, 1, 2));
  const used = m.feedInterim('قل هو كلام'.split(' '));
  assert.equal(used, 2);
  assert.equal(m.pos, 2);
  assert.equal(m.score().mistakes, 0);
});

test('التلميح يسجّل الكلمة كمنسية', () => {
  const m = new Matcher(words(112, 1, 1));
  say(m, 'قل هو');
  m.hint();
  say(m, 'أحد');
  assert.deepEqual(m.status, [STATUS.OK, STATUS.OK, STATUS.HINT, STATUS.OK]);
});

test('تطبيع الحروف', () => {
  assert.equal(Q.normalizeArabic('ٱلرَّحۡمَٰنِ'), 'الرحمن');
  assert.equal(Q.normalizeArabic('إِيَّاكَ'), 'اياك');
  assert.equal(Q.normalizeArabic('ٱلصَّلَوٰةَ'), 'الصلوه');
});

test('في بداية المقطع: الاستعاذة والبسملة لا تُحسب أخطاء', () => {
  const m = new Matcher(words(112, 1, 4));
  say(m, 'أعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم قل هو الله أحد');
  assert.equal(m.score().mistakes, 0, m.status.join(','));
  assert.equal(m.pos, 4);
});

test('مراجعة آية من وسط السورة مع البدء بما قبلها', () => {
  const m = new Matcher(words(114, 3, 3));
  say(m, 'ملك الناس إله الناس');
  assert.ok(m.done);
  assert.equal(m.score().mistakes, 0);
});

test('زيادة واو العطف خطأ', () => {
  const m = new Matcher(words(112, 1, 1));
  say(m, 'قل هو الله واحد');
  say(m, 'أحد');
  assert.equal(m.status[3], STATUS.CORRECTED);
});

test('التجويد: الإدغام والإقلاب وإدغام التنوين لا تُحسب أخطاء', () => {
  // من ربهم → مربهم (إدغام) ، هدى من → هدمن (إدغام التنوين)
  let m = new Matcher(words(2, 5, 5));
  say(m, 'أولئك على هدى مربهم وأولئك هم المفلحون');
  assert.equal(m.score().mistakes, 0, m.status.map((s, i) => `${m.words[i].text}:${s}`).join(' '));
  assert.ok(m.done);
  m = new Matcher(words(2, 5, 5));
  say(m, 'أولئك على هدمن ربهم وأولئك هم المفلحون');
  assert.equal(m.score().mistakes, 0, m.status.map((s, i) => `${m.words[i].text}:${s}`).join(' '));

  // هدى للمتقين → هدللمتقين
  m = new Matcher(words(2, 2, 2));
  say(m, 'ذلك الكتاب لا ريب فيه هدللمتقين');
  assert.equal(m.score().mistakes, 0, m.status.map((s, i) => `${m.words[i].text}:${s}`).join(' '));
  assert.ok(m.done);

  // من بعد → ممبعد (إقلاب)
  m = new Matcher(words(2, 27, 27));
  say(m, 'الذين ينقضون عهد الله ممبعد ميثاقه ويقطعون ما أمر الله به أن يوصل ويفسدون في الأرض أولئك هم الخاسرون');
  assert.equal(m.score().mistakes, 0, m.status.map((s, i) => `${m.words[i].text}:${s}`).join(' '));
  assert.ok(m.done);
});

test('التجويد: القراءة بالإملاء العادي ما زالت مقبولة، وإسقاط كلمة ما زال يُكتشف', () => {
  const m = new Matcher(words(2, 5, 5));
  say(m, 'أولئك على هدى من ربهم وأولئك هم المفلحون');
  assert.equal(m.score().mistakes, 0);
  const m2 = new Matcher(words(2, 5, 5));
  say(m2, 'أولئك على هدى ربهم وأولئك هم المفلحون'); // أسقط "من"
  assert.equal(m2.score().mistakes, 1);
});
