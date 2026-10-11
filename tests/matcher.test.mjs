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

test('إسقاط كلمة واحدة: "لم تُسمع بوضوح" (التعرف الصوتي كثيراً ما يسقط كلمات)', () => {
  const m = new Matcher(words(112, 1, 4));
  say(m, 'قل هو الله أحد الله الصمد لم يلد ولم يولد ولم يكن له أحد'); // أسقط "كفوا"
  assert.ok(m.done);
  const bad = m.status.map((s, i) => [m.words[i].text, s]).filter(([, s]) => s !== STATUS.OK);
  assert.equal(bad.length, 1);
  assert.equal(bad[0][1], STATUS.UNSURE);
  assert.match(bad[0][0], /كُفُو/);
});

test('إسقاط ٣ كلمات فأكثر يُحسب خطأ', () => {
  // أسقط "له ما في السماوات" بعد "ولا نوم"
  const m2 = new Matcher(words(2, 255, 255));
  say(m2, 'الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم وما في الأرض من ذا الذي يشفع عنده إلا بإذنه');
  assert.ok(m2.status.filter((x) => x === STATUS.SKIPPED).length >= 3, m2.status.join(','));
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
  say(m2, 'أولئك على هدى من وأولئك هم المفلحون'); // أسقط "ربهم"
  assert.equal(m2.status[4], STATUS.UNSURE);
});

test('الحروف المقطعة: تُقبل بأسماء الحروف منفصلة أو متصلة أو كما تُكتب', () => {
  const cases = [
    [2, 1, 2, 'الف لام ميم ذلك الكتاب لا ريب فيه هدى للمتقين'],
    [2, 1, 2, 'ألف لام ميم ذلك الكتاب لا ريب فيه هدى للمتقين'],
    [2, 1, 2, 'الم ذلك الكتاب لا ريب فيه هدى للمتقين'],
    [19, 1, 1, 'كاف ها يا عين صاد'],
    [20, 1, 1, 'طه'],
    [20, 1, 1, 'طا ها'],
    [36, 1, 1, 'ياسين'],
    [36, 1, 1, 'يا سين'],
    [42, 1, 2, 'حا ميم عين سين قاف'],
    [38, 1, 1, 'صاد والقرآن ذي الذكر'],
    [68, 1, 1, 'نون والقلم وما يسطرون'],
    [7, 1, 1, 'الف لام ميم صاد'],
  ];
  for (const [s, from, to, said] of cases) {
    const m = new Matcher(words(s, from, to));
    say(m, said);
    assert.ok(m.done, `${s}:${from} «${said}» لم يكتمل: ${m.status.join(',')}`);
    assert.equal(m.score().mistakes, 0, `${s}:${from} «${said}»: ${m.status.map((x, i) => `${m.words[i].text}:${x}`).join(' ')}`);
  }
});

test('الحروف المقطعة: حرف خطأ يُحسب خطأ', () => {
  const m = new Matcher(words(2, 1, 2));
  say(m, 'الف لام را ذلك الكتاب لا ريب فيه هدى للمتقين');
  assert.ok(m.status[0] !== STATUS.OK, m.status.join(','));
});

test('الحروف المقطعة أثناء الكلام (نتائج مؤقتة) تنتظر حتى تكتمل الحروف', () => {
  const m = new Matcher(words(2, 1, 1));
  assert.equal(m.feedInterim(['الف', 'لام']), 0);
  assert.equal(m.feedInterim(['الف', 'لام', 'ميم']), 3);
  assert.ok(m.done);
});

test('المتشابهات: قراءة الآية بلفظ متشابهتها تُكتشف كخلط', () => {
  // البقرة ٥٨ بلفظ الأعراف ١٦١
  const m = new Matcher(words(2, 58, 58));
  say(m, 'وإذ قيل لهم اسكنوا هذه القرية وكلوا منها حيث شئتم رغدا وادخلوا الباب سجدا وقولوا حطة نغفر لكم خطيئاتكم وسنزيد المحسنين');
  const bad = m.status.map((x, i) => [i, x]).filter(([, x]) => x !== STATUS.OK);
  assert.ok(bad.length >= 3, m.status.join(','));
  const g = Q.toGlobal(2, 58);
  const conf = bad.map(([i, x]) => Q.confusionFor(g, m.words[i].w, m.heardAt[i], x)).filter((h) => h != null);
  assert.ok(conf.length >= 2, `confusions: ${conf}`);
  assert.ok(conf.every((h) => h === Q.toGlobal(7, 161)));
});

test('المتشابهات: البقرة ٤٨ بترتيب البقرة ١٢٣', () => {
  const m = new Matcher(words(2, 48, 48));
  say(m, 'واتقوا يوما لا تجزي نفس عن نفس شيئا ولا يقبل منها عدل ولا تنفعها شفاعة ولا هم ينصرون');
  assert.ok(m.score().mistakes >= 1);
  const g = Q.toGlobal(2, 48);
  const conf = m.status.map((x, i) => (x !== STATUS.OK ? Q.confusionFor(g, m.words[i].w, m.heardAt[i], x) : null)).filter((h) => h != null);
  assert.ok(conf.includes(Q.toGlobal(2, 123)), `confusions: ${conf}`);
});

test('المتشابهات: القراءة الصحيحة لا تتأثر', () => {
  for (const [s, a, text] of [
    [2, 58, 'وإذ قلنا ادخلوا هذه القرية فكلوا منها حيث شئتم رغدا وادخلوا الباب سجدا وقولوا حطة نغفر لكم خطاياكم وسنزيد المحسنين'],
    [7, 161, 'وإذ قيل لهم اسكنوا هذه القرية وكلوا منها حيث شئتم وقولوا حطة وادخلوا الباب سجدا نغفر لكم خطيئاتكم سنزيد المحسنين'],
    [2, 48, 'واتقوا يوما لا تجزي نفس عن نفس شيئا ولا يقبل منها شفاعة ولا يؤخذ منها عدل ولا هم ينصرون'],
  ]) {
    const m = new Matcher(words(s, a, a));
    say(m, text);
    assert.equal(m.score().mistakes, 0, `${s}:${a} ${m.status.map((x, i) => `${m.words[i].text}:${x}`).join(' ')}`);
  }
});

test('كلمة قصيرة أسقطها التعرف الصوتي (في، من…) تُعلَّم "لم تُسمع بوضوح" ولا تُحسب خطأ', () => {
  const m = new Matcher(words(114, 5, 5));
  say(m, 'الذي يوسوس صدور الناس');
  assert.equal(m.status[2], STATUS.UNSURE);
  assert.equal(m.score().mistakes, 0);
});

test('الوقف والغنة: تكرار آخر الجملة بعد الوقفة، وحرف منفرد، و"ان" قبل الناس — لا أخطاء', () => {
  const m = new Matcher(words(114, 4, 6));
  for (const f of ['من شر الوسواس الخناس ن', 'من شر الوسواس الخناس الذي يوسوس في صدور ان الناس', 'من الجنة ون ناس']) say(m, f);
  assert.ok(m.done, m.status.join(','));
  assert.equal(m.score().mistakes, 0, m.status.map((x, i) => `${m.words[i].text}:${x}`).join(' '));
});

test('كلمة ضاعت أثناء إعادة تشغيل الميكروفون لا تُحسب خطأ', () => {
  const m = new Matcher(words(114, 4, 5));
  say(m, 'من شر الوسواس الخناس');
  m.afterGap = true;
  say(m, 'يوسوس في صدور الناس');
  assert.equal(m.status[4], STATUS.UNSURE);
  assert.equal(m.score().mistakes, 0);
});

test('تسجيل حقيقي من آيفون (سورة الناس مقروءة صح): لا أخطاء', () => {
  // ما كتبه التعرف الصوتي فعلاً: تكرار في بداية كل جزء، و"من شر" ← "يشل"، و"الخناس" ضاعت، وآخر كلمة لم تصل
  const m = new Matcher(words(114, 1, 6));
  for (const f of ['المحمول المحمول قل أعوذ برب الناس', 'قل أعوذ برب الناس ملك الناس إله الناس', 'ما الناس إله الناس وسواس', 'يشل الوسواس', 'الذي يوسوس في صدور الناس من الجن']) say(m, f);
  assert.equal(m.score().mistakes, 0, m.status.map((x, i) => `${m.words[i].text}:${x}`).join(' '));
  assert.ok(m.finishTail());
  assert.ok(m.done);
  assert.equal(m.score().mistakes, 0);
});

test('كلمة قرآنية مكان الكلمة (ربي بدل برب) خطأ، وتشويش ليس من القرآن (يشل) لم يُسمع بوضوح', () => {
  const m = new Matcher(words(114, 1, 1));
  say(m, 'قل أعوذ ربي الناس');
  assert.equal(m.status[2], STATUS.WRONG);
  const m2 = new Matcher(words(113, 1, 1));
  say(m2, 'قل أعوذ يشل الفلق');
  assert.equal(m2.status[2], STATUS.UNSURE, m2.status.join(','));
});

test('نتيجة مؤقتة تعيد ما قُرئ قبلها (آيفون): الكلمات الجديدة تظهر فوراً', () => {
  // الإخلاص: ظهر حتى «لم يلد» ثم وصلت نتيجة مؤقتة جديدة تبدأ من «الله الصمد»
  const m = new Matcher(words(112, 1, 4));
  say(m, 'قل هو الله أحد');
  m.feedInterim('الله الصمد لم يلد'.split(' '));
  assert.equal(m.words[m.pos].text.replace(/[^ء-ي]/g, ''), 'ولم');
  const n = m.feedInterim('الله الصمد لم يلد ولم يولد'.split(' '));
  assert.equal(n, 6);
  assert.equal(m.status[7], STATUS.OK);
  // إعادة تقسيم: «لميلد» كانت كلمة ثم صارت «لم يلد» — باقي الكلمات بعد العدّ القديم يبدأ بكلمة مقروءة
  const m2 = new Matcher(words(112, 1, 4));
  say(m2, 'قل هو الله أحد الله الصمد لم يلد');
  assert.equal(m2.feedInterim('يلد ولم يولد'.split(' ')), 3);
  assert.equal(m2.status[7], STATUS.OK);
  assert.equal(m2.score().mistakes, 0);
});
