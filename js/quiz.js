// «كمّل الآية» و«ربط الصفحات»: اختبار الحفظ بأسئلة قصيرة
// كمّل الآية: تسمع وترى أول كلمات آية وتكمّلها من حفظك
// ربط الصفحات: ترى وتسمع آخر آية في صفحة وتقول أول آية في الصفحة التالية

import { ayahWords, ayahPage, pageAyahs, fromGlobal, surahName, toArabicDigits as ar, PAGES } from './quran.js';
import { getState } from './store.js';
import { recordSession } from './plan.js';
import { isMistake } from './matcher.js';
import { Recitation } from './recitation.js';
import { Player, wordUrl, ayahUrl } from './audio.js';
import { voiceFix } from './voicefix.js';
import { icon } from './icons.js';

export const QUIZ_SIZE = 10;

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// كم كلمة نعطيها كبداية: كلمة للآية القصيرة، وحتى ٣ للطويلة (ويبقى نصف الآية على الأقل للتسميع)
export const givenCount = (n) => (n <= 3 ? 1 : n <= 6 ? 2 : 3);

// أسئلة «كمّل الآية»: [{ ayahs: [g], given }]
export function buildContinue(pool, n = QUIZ_SIZE, rand = Math.random) {
  const ok = [...pool].filter((g) => ayahWords(g).length >= 2);
  return shuffle(ok, rand).slice(0, n).map((g) => ({ ayahs: [g], given: givenCount(ayahWords(g).length) }));
}

// أسئلة «ربط الصفحات»: آخر آية في صفحة ← أول آية في التالية (الاثنتان في المحفوظ)
export function buildLink(pool, n = QUIZ_SIZE, rand = Math.random) {
  const set = new Set(pool);
  const pages = new Set([...set].map(ayahPage));
  const out = [];
  for (const p of pages) {
    if (p >= PAGES) continue;
    const last = pageAyahs(p).at(-1);
    const first = pageAyahs(p + 1)[0];
    if (set.has(last) && set.has(first)) out.push({ ayahs: [last, first], given: ayahWords(last).length, page: p });
  }
  return shuffle(out, rand).slice(0, n);
}

const refOf = (g) => { const { s, a } = fromGlobal(g); return `${surahName(s)} ${ar(a)}`; };

/**
 * ctx: { app, back, toast, setCleanup, go }
 * opts: { pool: [g], mode: 'continue' | 'link', label, returnTo }
 */
export function renderQuiz(ctx, { pool, mode = 'continue', label, returnTo = 'home' }) {
  const { app, back, toast, setCleanup, go } = ctx;
  const st = getState();
  const questions = mode === 'link' ? buildLink(pool) : buildContinue(pool);
  const title = mode === 'link' ? 'ربط الصفحات' : 'كمّل الآية';

  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>${title}</h1><p class="muted small" id="q-count"></p></div>
      <span id="q-score" class="tag ok"></span>
    </div>
    <div class="progress" aria-hidden="true"><i id="q-bar" style="width:0"></i></div>
    <div id="q-stage"></div>
    <div class="mushaf quiz" id="mushaf" aria-label="السؤال"></div>
    <div id="q-result" tabindex="-1"></div>
    <div class="dock" id="dock"></div>`;

  const stageEl = document.getElementById('q-stage');
  const resultEl = document.getElementById('q-result');

  if (!questions.length) {
    document.getElementById('dock').hidden = true;
    stageEl.innerHTML = `<div class="card empty-state">${icon('info')}<p>${mode === 'link'
      ? 'المقطع ده كله في صفحة واحدة، فمفيش ربط بين صفحات. اختار مقطع أطول (صفحتين على الأقل).'
      : 'مفيش آيات كفاية في المقطع ده. اختار مقطع أطول.'}</p>
      <button type="button" class="btn" data-act="back">رجوع</button></div>`;
    app.onclick = (e) => { if (e.target.closest('[data-act=back]')) back(returnTo); };
    setCleanup(() => {});
    return;
  }

  const prompt = new Player();
  const rec = new Recitation({
    mushafEl: document.getElementById('mushaf'),
    dockEl: document.getElementById('dock'),
    lang: st.settings.lang,
    weak: st.weak,
    warnWeak: false,
    layout: 'flow',
    finishLabel: 'خلصت السؤال',
    onError: (msg) => toast(msg, 5000),
    onComplete: () => judge(),
    onFinishRequest: () => judge(),
    onMistake: (list) => fixer.onMistake(list),
  });
  const fixer = voiceFix(rec, { enabled: () => getState().settings.voiceFix, reciter: () => getState().settings.reciter });
  // لو ضغط الميكروفون أثناء البداية فهو جاهز: نوقف الصوت حتى لا يضيع كلامه
  document.getElementById('dock').addEventListener('click', (e) => {
    if (e.target.closest('[data-r=mic]') && prompt.playing) prompt.stop();
  }, true);

  const results = [];    // { q, correct, mistakes, words, status }
  let idx = 0;
  let judged = false;
  let promptSeq = 0;
  let holdingMic = false;

  function updateHead() {
    document.getElementById('q-count').textContent = `سؤال ${ar(Math.min(idx + 1, questions.length))} من ${ar(questions.length)}`;
    const right = results.filter((r) => r.correct).length;
    document.getElementById('q-score').textContent = results.length ? `${ar(right)} صح` : '';
    document.getElementById('q-bar').style.width = `${(results.length / questions.length) * 100}%`;
  }

  function playPrompt() {
    const q = questions[idx];
    const items = mode === 'link'
      ? [{ urls: [ayahUrl(q.ayahs[0], getState().settings.reciter)] }]
      // كلمة كلمة فقط (بدون صوت الآية كاملة حتى لا نسمعه الإجابة)
      : Array.from({ length: q.given }, (_, k) => ({ urls: [wordUrl(q.ayahs[0], k)] }));
    const seq = ++promptSeq;
    // كمّل الآية: البداية كلمات ظاهرة أصلاً، فلو الميكروفون سمعها من السماعة بتتجاهَل — تقدر تبدأ على طول
    if (mode !== 'link') { prompt.play(items); return; }
    // ربط الصفحات: الآية كاملة، فالميكروفون يستنى لحد ما تخلص (حتى لا يسمع السماعة)
    if (!holdingMic) { holdingMic = true; rec.pause(); }
    rec.heardEl.textContent = 'استنى لحد ما الآية تخلص، وبعدين قول أول آية في الصفحة اللي بعدها…';
    prompt.play(items).then(() => {
      if (seq !== promptSeq) return; // اتعادت البداية؛ التشغيل الجديد هو اللي يرجّع الميكروفون
      holdingMic = false;
      rec.resume();
      if (!judged) rec.heardEl.textContent = rec.listening ? 'دورك — قول أول آية في الصفحة التالية' : 'اضغط على الميكروفون وقول أول آية في الصفحة التالية';
    });
  }

  function ask() {
    judged = false;
    prompt.stop();
    fixer.stop();
    const q = questions[idx];
    resultEl.innerHTML = '';
    rec.setDockHidden(false);
    rec.load({ ayahs: q.ayahs, visible: (i) => i < q.given, given: q.given });
    const target = q.ayahs.at(-1);
    stageEl.innerHTML = `<div class="card quiz-ask">
      <p>${mode === 'link'
        ? `دي آخر آية في <b>صفحة ${ar(q.page)}</b>. قول <b>أول آية في الصفحة اللي بعدها</b> (${ar(q.page + 1)}).`
        : `كمّل الآية من حفظك بعد الكلمات الظاهرة <span class="muted small">(${refOf(target)})</span>`}</p>
      <button type="button" class="pill" data-act="replay">${icon('repeat', { size: 16 })}اسمع البداية تاني</button>
    </div>`;
    updateHead();
    playPrompt();
  }

  function judge() {
    if (judged) return;
    judged = true;
    const m = rec.matcher;
    // «خلصت»: آخر كلمة أو كلمتين ربما قيلتا ولم تصلا؛ لو باقي أكتر نكشفها كمنسية
    if (!m.done && m.words.length - m.pos <= 2) m.finishTail(2);
    while (!m.done) m.hint();
    rec.paint();
    const sc = m.score();
    const correct = sc.done === sc.total && sc.mistakes === 0;
    const keep = m.status.map((x, i) => i).filter((i) => m.status[i] !== 'given');
    results.push({ q: questions[idx], correct, mistakes: sc.mistakes, words: keep.map((i) => rec.words[i]), status: keep.map((i) => m.status[i]) });
    // الميكروفون يفضل شغال للسؤال التالي، لكن الكلام يتجاهَل لحد ما يبدأ
    rec.completed = true;
    rec.setDockHidden(true);
    updateHead();
    const last = idx === questions.length - 1;
    const unsure = m.status.filter((x) => x === 'unsure').length;
    const okText = unsure ? 'صح غالباً — بس فيه كلمات ما اتسمعتش بوضوح (الخط المتقطع)' : 'صح، ما شاء الله!';
    resultEl.innerHTML = `<div class="card quiz-verdict ${correct ? 'ok' : 'bad'}">
      <p class="verdict ${correct ? 'ok' : 'warn'}">${icon(correct ? 'checkCircle' : 'alert')}<span>${correct ? okText : `فيها ${ar(Math.max(1, sc.mistakes))} ${sc.mistakes > 1 ? 'أخطاء' : 'غلطة'} — الكلمات الملونة`}</span></p>
      <div class="row actions">
        <button type="button" class="btn primary" data-act="next">${last ? `${icon('flag', { size: 18 })}النتيجة` : `السؤال التالي${icon('chevronL', { size: 18 })}`}</button>
        ${correct ? '' : `<button type="button" class="btn" data-act="retry">${icon('repeat', { size: 18 })}حاول تاني</button>`}
      </div></div>`;
    resultEl.querySelector('[data-act=next]').focus({ preventScroll: true });
    resultEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function summary() {
    rec.destroy();
    prompt.stop();
    const words = results.flatMap((r) => r.words);
    const status = results.flatMap((r) => r.status);
    const mistakes = status.filter(isMistake).length;
    const done = status.length;
    const right = results.filter((r) => r.correct).length;
    if (done) recordSession({ taskId: 'quiz', label: title, words, status, score: { total: done, done, mistakes, accuracy: Math.round(((done - mistakes) / done) * 100) } });
    const missed = results.filter((r) => !r.correct);
    document.getElementById('mushaf').hidden = true;
    stageEl.innerHTML = '';
    resultEl.innerHTML = `<section class="card result">
      <div class="result-top">
        <div class="result-score ${right / results.length < 0.8 ? 'low' : ''}">${ar(right)}/${ar(results.length)}</div>
        <div><h2>${right === results.length ? 'ممتاز، كله صح!' : right / results.length >= 0.7 ? 'كويس، راجع اللي فاتك' : 'محتاج تثبيت أكتر'}</h2>
        <p class="muted small">${title} · الأخطاء اتسجلت في نقاط الضعف</p></div>
      </div>
      ${missed.length ? `<h3>اللي محتاج مراجعة</h3><ul class="mistake-list">${missed.map((r) => `<li><span>${mode === 'link' ? `صفحة ${ar(r.q.page)} ← ${ar(r.q.page + 1)}: ` : ''}${refOf(r.q.ayahs.at(-1))}</span></li>`).join('')}</ul>` : ''}
      <div class="row actions">
        ${missed.length ? `<button type="button" class="btn primary" data-act="drill">${icon('mic')}سمّع اللي فاتك</button>` : ''}
        <button type="button" class="btn ${missed.length ? '' : 'primary'}" data-act="again">${icon('repeat')}اختبار جديد</button>
        <button type="button" class="btn ghost" data-act="back">رجوع</button>
      </div></section>`;
    resultEl.focus({ preventScroll: true });
    document.getElementById('q-bar').style.width = '100%';
  }

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') back(returnTo);
    if (act === 'replay' && !judged) playPrompt();
    if (act === 'retry') { results.pop(); ask(); }
    if (act === 'next') { idx++; if (idx < questions.length) ask(); else summary(); }
    if (act === 'again') go('quiz', { pool, mode, label, returnTo });
    if (act === 'drill') {
      const list = [...new Set(results.filter((r) => !r.correct).flatMap((r) => r.q.ayahs))].sort((x, y) => x - y);
      go('recite', { taskId: 'free', label: 'مراجعة أسئلة الاختبار', ayahs: list, returnTo });
    }
  };
  setCleanup(() => { prompt.stop(); fixer.stop(); rec.destroy(); });
  ask();
}
