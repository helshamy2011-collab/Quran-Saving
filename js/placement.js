// «سمّع اللي حافظه»: تسمّع من حفظك من أول السورة (أو من بعد آخر ما حفظته)،
// ومكان ما تقف يبدأ منه الحفظ الجديد. اللي قرأته يتسجّل محفوظ، وأخطاؤك فيه تدخل نقاط الضعف

import { ayahCount, toGlobal, surahName, toArabicDigits as ar, ayatLabel as ayatCount } from './quran.js';
import { getState, update, dayKey } from './store.js';
import { memorizedSet, recordSession, completeSet, noteCompleted } from './plan.js';
import { STATUS, isMistake } from './matcher.js';
import { Recitation } from './recitation.js';
import { icon } from './icons.js';

// كلمة تعني إنه وقف هنا (مش حافظ): أخطأ، أو أسقطها، أو قال «نسيتها»، أو لم يصل لها
const stopped = (st) => st === STATUS.WRONG || st === STATUS.SKIPPED || st === STATUS.HINT || st === STATUS.HIDDEN;

// أول آية وقف عندها (رقمها في القائمة)؛ = طول القائمة لو قرأها كلها
export function stopIndex(ayahs, words, status) {
  const bad = new Set();
  words.forEach((w, i) => { if (stopped(status[i])) bad.add(w.g); });
  const k = ayahs.findIndex((g) => bad.has(g));
  return k < 0 ? ayahs.length : k;
}

// أول آية في السورة لم تُحفظ بعد (نبدأ التسميع منها)
export function firstUnknown(s, known = memorizedSet()) {
  for (let a = 1; a <= ayahCount(s); a++) if (!known.has(toGlobal(s, a))) return a;
  return null;
}

/**
 * ctx: { app, back, toast, setCleanup, go }
 * opts: { s: السورة، returnTo }
 */
export function renderPlacement(ctx, { s, returnTo = 'home' }) {
  const { app, back, toast, setCleanup, go } = ctx;
  const st = getState();
  const from = firstUnknown(s);

  if (from == null) {
    toast(`سورة ${surahName(s)} محفوظة كلها عندك`);
    go(returnTo, {}, { push: false });
    return;
  }

  const ayahs = [];
  for (let a = from; a <= ayahCount(s); a++) ayahs.push(toGlobal(s, a));

  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>سمّع اللي حافظه</h1><p class="muted small">سورة ${surahName(s)}${from > 1 ? ` · من الآية ${ar(from)}` : ''}</p></div>
    </div>
    <div class="alert info" role="note">${icon('info')}<div>اقرأ من حفظك ${from > 1 ? `من الآية <b>${ar(from)}</b>` : 'من أول السورة'}.
      لما توصل لمكان مش حافظه اضغط <b>«نسيتها»</b> أو <b>«وقفت هنا»</b> — وهبدأ أحفّظك من المكان ده.</div></div>
    <div class="mushaf" id="mushaf" aria-label="نص السورة"></div>
    <div id="result" tabindex="-1"></div>
    <div class="dock" id="dock"></div>`;

  let concluded = false;
  const rec = new Recitation({
    mushafEl: document.getElementById('mushaf'),
    dockEl: document.getElementById('dock'),
    lang: st.settings.lang,
    weak: st.weak,
    warnWeak: false,
    finishLabel: 'وقفت هنا',
    onError: (msg) => toast(msg, 5000),
    onComplete: () => conclude(),
    onFinishRequest: () => conclude(),
    // «نسيتها» = وصل لمكان مش حافظه
    onMistake: (list) => { if (list.some((i) => rec.status[i] === STATUS.HINT)) setTimeout(conclude, 0); },
  });
  rec.load({ ayahs, visible: () => false });

  function conclude() {
    if (concluded) return;
    concluded = true;
    const m = rec.matcher;
    // آخر كلمة أو كلمتين ربما قيلتا ولم تصلا
    if (!m.done && m.words.length - m.pos <= 2) m.finishTail(2);
    rec.paint();
    rec.destroy();
    document.getElementById('dock').hidden = true;
    let k = stopIndex(ayahs, rec.words, m.status);
    const total = ayahs.length;
    const res = document.getElementById('result');

    const render = () => {
      const all = k === total;
      const startA = from + k;
      res.innerHTML = `<section class="card result placement">
        <h2>${k === 0 ? 'ولا يهمك — نبدأ من الأول' : all ? 'ما شاء الله، حافظ السورة كلها!' : 'ما شاء الله!'}</h2>
        <p>${k === 0 ? `هبدأ أحفّظك من <b>الآية ${ar(from)}</b>.`
          : `حافظ من الآية <b>${ar(from)}</b> لحد <b>${ar(startA - 1)}</b> (${ayatCount(k)}).`}</p>
        ${all ? '<p>هبدأ معاك الحفظ الجديد من السورة اللي بعدها في خطتك.</p>' : k ? `<p>الحفظ الجديد هيبدأ من <b>الآية ${ar(startA)}</b>.</p>` : ''}
        <div class="field">
          <span id="stop-label">ابدأ الحفظ الجديد من الآية</span>
          <div class="ayah-stepper" role="group" aria-labelledby="stop-label">
            <button type="button" class="icon-btn" data-act="less" aria-label="آية قبلها" ${k === 0 ? 'disabled' : ''}>−</button>
            <output aria-live="polite">${all ? 'السورة اللي بعدها' : ar(startA)}</output>
            <button type="button" class="icon-btn" data-act="more" aria-label="آية بعدها" ${all ? 'disabled' : ''}>+</button>
          </div>
          <p class="muted small">لو البرنامج ما سمعكش كويس، عدّل الآية من هنا.</p>
        </div>
        ${rec.words.some((w, i) => ayahs.indexOf(w.g) < k && isMistake(m.status[i])) ? '<p class="muted small">الكلمات اللي غلطت فيها في الجزء اللي حافظه هتدخل نقاط الضعف للمراجعة.</p>' : ''}
        <div class="row actions">
          <button type="button" class="btn primary" data-act="save">${icon('check')}تمام، ابدأ من هنا</button>
          <button type="button" class="btn" data-act="again">${icon('repeat')}سمّع تاني</button>
        </div>
      </section>`;
    };
    render();
    res.focus({ preventScroll: true });
    res.scrollIntoView({ block: 'center', behavior: 'smooth' });

    res.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'less' && k > 0) { k--; render(); }
      if (b.dataset.act === 'more' && k < total) { k++; render(); }
      if (b.dataset.act === 'again') go('placement', { s, returnTo });
      if (b.dataset.act === 'save') save(k);
    };
  }

  function save(k) {
    const known = ayahs.slice(0, k);
    const keep = new Set(known);
    const idx = rec.words.map((w, i) => i).filter((i) => keep.has(rec.words[i].g));
    if (idx.length) {
      const status = idx.map((i) => rec.status[i]);
      const mistakes = status.filter(isMistake).length;
      recordSession({
        taskId: 'free', label: `تسميع المحفوظ — ${surahName(s)}`,
        words: idx.map((i) => rec.words[i]), status,
        score: { total: idx.length, done: idx.length, mistakes, accuracy: Math.round(((idx.length - mistakes) / idx.length) * 100) },
      });
    }
    const today = dayKey();
    update((x) => {
      const before = completeSet(x);
      const set = new Set(x.memorized);
      known.forEach((g) => set.add(g));
      // محفوظ قديم: يدخل المراجعة البعيدة (مش القريبة، حتى لا تتضخم لو حافظ كتير)
      x.memorized = [...set];
      // باقي السورة يتحفظ الأول (السورة اللي بتكمّلها)؛ لو خلصت بتتسجل وتنتهي
      x.settings.focusSurah = s;
      noteCompleted(x, before, today);
      // نعيد بناء ورد اليوم ليبدأ من مكان ما وقف (لو لم يُعتمد حفظ اليوم بعد)
      if (x.days[today] && !x.days[today].tasks.new.done) delete x.days[today];
    });
    const startA = from + k;
    toast(k === ayahs.length ? `ما شاء الله — سورة ${surahName(s)} اتسجلت محفوظة` : `تمام — الحفظ الجديد يبدأ من ${surahName(s)} ${ar(startA)}`);
    go('home');
  }

  app.onclick = (e) => {
    const b = e.target.closest('[data-act=back]');
    if (b && !b.closest('#result')) back(returnTo);
  };
  setCleanup(() => { concluded = true; rec.destroy(); });
}

