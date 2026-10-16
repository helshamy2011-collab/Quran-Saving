// وضع «حفّظني»: يمشي مع المستخدم آية آية
// استماع ← قراءة بالنظر ← إخفاء تدريجي ← تسميع من الحفظ ← ربط بما قبلها ← مقارنة القراءة بالحفظ

import { ayahWords, fromGlobal, surahName, describeAyahs, toArabicDigits as ar } from './quran.js';
import { getState } from './store.js';
import { recordPractice } from './plan.js';
import { isMistake } from './matcher.js';
import { Recitation } from './recitation.js';
import { icon } from './icons.js';
import { voiceFix } from './voicefix.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = (w) => `${w.g}:${w.w}`;

const STAGES = {
  listen: { name: 'استمع', title: 'استمع للآية', desc: 'استمع وعينك على المصحف. ركّز في النطق ومواضع الوقف.' },
  read: { name: 'اقرأ', title: 'اقرأ والمصحف مفتوح', desc: 'اقرأ الآية بصوتك والنص ظاهر. دي القراءة اللي هنقارن بيها تسميعك بعد كده.' },
  fade1: { name: 'إخفاء ١', title: 'اقرأ وبعض الكلمات مخفية', desc: 'أخفيت ثلث الكلمات. اقرأ الآية كاملة واستحضر المخفي من ذاكرتك.' },
  fade2: { name: 'إخفاء ٢', title: 'أغلب الكلمات مخفية', desc: 'أخفيت ثلثي الكلمات. اعتمد على حفظك أكثر.' },
  hidden: { name: 'من حفظك', title: 'سمّع الآية من حفظك', desc: 'النص كله مخفي. سمّع الآية كاملة.' },
  link: { name: 'اربط', title: 'اربطها بما قبلها', desc: 'سمّع من أول الورد لحد الآية دي، عشان الآيات تتربط ببعض.' },
};

// المرحلة تنجح بهذه النسبة (المراحل الأخيرة بنسبة الإتقان في الخطة)
function threshold(stage, passMark) {
  if (stage === 'read') return 0; // القراءة مرجع للمقارنة، لا تنجح ولا ترسب
  if (stage === 'fade1' || stage === 'fade2') return 80;
  return passMark;
}

function stagesFor(k, g) {
  const list = ['listen', 'read'];
  if (ayahWords(g).length > 3) list.push('fade1', 'fade2');
  list.push('hidden');
  if (k > 0) list.push('link');
  return list;
}

export function renderGuided(ctx, { ayahs, label = 'حفّظني' }) {
  const { app, back, toast, setCleanup, onFinal } = ctx;
  const st = getState();
  const settings = st.settings;
  const reps = 3;

  // نتائج هذه الجلسة للمقارنة
  const readMiss = new Map();   // كلمة → أخطأ وهو يقرأ بالنظر؟
  const memory = new Map();     // كلمة → { miss, ok } من الحفظ (الكلمات المخفية فقط)
  const memScores = [];

  let k = 0;
  let stageIdx = 0;
  let attempts = 0;
  let audio = null;
  let advanceTimer = null;

  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>${esc(label)}</h1><p class="muted small">${esc(describeAyahs(ayahs))}</p></div>
      <span class="tag soft" id="ayah-count"></span>
    </div>
    <ol class="stepper" id="stepper" aria-label="مراحل حفظ الآية"></ol>
    <section class="card stage" id="stage" aria-live="polite"></section>
    <div class="mushaf" id="mushaf" aria-label="نص الآية"></div>
    <div id="summary" tabindex="-1"></div>
    <div class="dock" id="dock"></div>
  `;
  const stageEl = document.getElementById('stage');
  const stepperEl = document.getElementById('stepper');

  const rec = new Recitation({
    mushafEl: document.getElementById('mushaf'),
    dockEl: document.getElementById('dock'),
    lang: settings.lang,
    weak: st.weak,
    warnWeak: false,
    finishLabel: 'إنهاء المرحلة',
    onError: (msg) => toast(msg, 5000),
    onComplete: () => stageDone(),
    onFinishRequest: () => { if (rec.matcher.pos > 0) stageDone(); },
    onMistake: (list) => fixer.onMistake(list),
  });
  const fixer = voiceFix(rec, { enabled: () => getState().settings.voiceFix, reciter: () => getState().settings.reciter });

  const current = () => stagesFor(k, ayahs[k])[stageIdx];

  function stopAudio() {
    if (audio) { audio.onended = null; audio.pause(); audio = null; }
  }

  function clearTimer() { clearTimeout(advanceTimer); advanceTimer = null; }

  function renderStepper() {
    const list = stagesFor(k, ayahs[k]);
    document.getElementById('ayah-count').textContent = `آية ${ar(k + 1)} من ${ar(ayahs.length)}`;
    stepperEl.innerHTML = list.map((s, i) => `<li class="${i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''}" ${i === stageIdx ? 'aria-current="step"' : ''}>
      ${i < stageIdx ? icon('check', { size: 14 }) : ''}${STAGES[s].name}</li>`).join('');
    const now = stepperEl.querySelector('.now');
    if (now) stepperEl.scrollLeft = now.offsetLeft - stepperEl.clientWidth / 2 + now.offsetWidth / 2;
  }

  function stageHead(s, extra = '') {
    return `<h2>${STAGES[s].title}</h2><p class="muted">${STAGES[s].desc}</p>${extra}`;
  }

  // ---- بدء مرحلة ----
  function startStage() {
    clearTimer();
    stopAudio();
    fixer.stop();
    const s = current();
    const g = ayahs[k];
    renderStepper();

    if (s === 'listen') {
      rec.pause();
      rec.setDockHidden(true);
      rec.load({ ayahs: [g], visible: () => true, reading: true });
      stageEl.innerHTML = stageHead(s, `<div class="row actions">
        <button type="button" class="btn primary" data-act="play">${icon('play', { size: 16 })}<span>شغّل (${ar(reps)} مرات)</span></button>
        <button type="button" class="btn" data-act="next">${icon('back', { size: 16, cls: 'flip' })}التالي</button>
      </div><p class="muted small" id="listen-status">القارئ: ${esc(readerName(settings.reciter))}</p>`);
      play(g, reps);
      return;
    }

    rec.setDockHidden(false);
    rec.resume();
    let visible;
    let list = [g];
    if (s === 'read') visible = () => true;
    if (s === 'fade1') visible = (i) => i === 0 || i % 3 !== 1;
    if (s === 'fade2') visible = (i) => i === 0 || i % 3 === 0;
    if (s === 'hidden') visible = () => false;
    if (s === 'link') { list = ayahs.slice(0, k + 1); visible = () => false; }
    rec.load({ ayahs: list, visible, reading: s === 'read' });
    stageEl.innerHTML = stageHead(s, attempts ? `<p class="small attempt">${icon('repeat', { size: 14 })}محاولة رقم ${ar(attempts + 1)}</p>` : '');
    if (!rec.listening && !rec.manual) stageEl.insertAdjacentHTML('beforeend', `<p class="small muted">${icon('mic', { size: 14 })}اضغط على الميكروفون وابدأ.</p>`);
  }

  function play(g, times) {
    stopAudio();
    const { s, a } = fromGlobal(g);
    const url = `https://everyayah.com/data/${settings.reciter}/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`;
    let n = 0;
    const statusEl = document.getElementById('listen-status');
    const once = () => {
      if (n >= times) {
        if (statusEl) statusEl.textContent = 'انتهى الاستماع — اضغط «التالي» لما تكون جاهز.';
        stageEl.querySelector('[data-act=next]')?.classList.add('primary');
        return;
      }
      n++;
      if (statusEl) statusEl.textContent = `الاستماع ${ar(n)} من ${ar(times)}…`;
      const el = new Audio(url);
      audio = el;
      el.onended = () => { if (audio === el) once(); };
      el.onerror = () => { if (statusEl) statusEl.textContent = 'تعذر تشغيل الصوت (يحتاج إنترنت). اقرأ الآية بنفسك ثم اضغط «التالي».'; };
      el.play().catch(() => { if (statusEl) statusEl.textContent = 'اضغط «شغّل» لبدء الاستماع.'; });
    };
    once();
  }

  // ---- نهاية مرحلة ----
  function stageDone() {
    const s = current();
    const sc = rec.score;
    const words = rec.words;
    const status = rec.status.slice();

    if (s === 'read') {
      words.forEach((w, i) => { if (i < sc.done) readMiss.set(keyOf(w), isMistake(status[i])); });
      recordPractice({ reading: [{ words, status }] });
    } else {
      // من الحفظ: نحسب الكلمات التي كانت مخفية فقط
      // ونستبعد الكلمات التي تعثر فيها حتى وهو يقرأ بالنظر: ليست خطأ حفظ
      const hiddenOnly = status.map((x, i) => (rec.visible[i] || readMiss.get(keyOf(words[i])) ? 'hidden' : x));
      words.forEach((w, i) => {
        if (rec.visible[i] || i >= sc.done) return;
        const m = memory.get(keyOf(w)) || { miss: 0, ok: 0 };
        if (isMistake(status[i])) m.miss++; else m.ok++;
        memory.set(keyOf(w), m);
      });
      if (s === 'hidden' || s === 'link') {
        memScores.push(sc);
        recordPractice({ memory: [{ words, status: hiddenOnly }] });
      }
    }

    const need = threshold(s, settings.passMark);
    const passed = sc.done === sc.total && sc.accuracy >= need;
    const mistakes = status.map((x, i) => ({ x, i })).filter((o) => isMistake(o.x));

    if (s === 'read') {
      stageEl.innerHTML = `<h2>قراءتك بالنظر: ${ar(sc.accuracy)}٪</h2>
        ${mistakes.length ? `<p class="muted">تعثرت في: ${mistakes.map(({ i }) => `<mark>${words[i].text}</mark>`).join('، ')} — ركّز في نطقها؛ وقت التسميع مش هتتحسب عليك لو البرنامج ما فهمهاش.</p>` : '<p class="muted">قراءة سليمة.</p>'}
        <div class="row actions">
          <button type="button" class="btn primary" data-act="next">التالي: ${STAGES[stagesFor(k, ayahs[k])[stageIdx + 1]].name}</button>
          <button type="button" class="btn" data-act="retry">${icon('repeat', { size: 16 })}اقرأ مرة أخرى</button>
        </div>`;
      focusNext();
      return;
    }

    const compare = s === 'hidden' ? comparisonFor([ayahs[k]]) : '';
    if (passed) {
      attempts = 0;
      stageEl.innerHTML = `<h2 class="ok-text">${icon('checkCircle')}أحسنت — ${ar(sc.accuracy)}٪</h2>${compare}
        <div class="row actions">
          <button type="button" class="btn primary" data-act="next">${nextLabel()}</button>
          <button type="button" class="btn" data-act="retry">${icon('repeat', { size: 16 })}أعد المرحلة</button>
        </div>`;
      focusNext();
    } else {
      attempts++;
      stageEl.innerHTML = `<h2 class="warn-text">${icon('alert')}${ar(sc.accuracy)}٪ — تحتاج ${ar(need)}٪</h2>${compare}
        <p class="muted">${attempts >= 2 ? 'ارجع اقرأها بالنظر مرة وبعدين جرّب تاني.' : 'جرّب تاني — الكلمات الملونة هي اللي محتاجة تركيز.'}</p>
        <div class="row actions">
          <button type="button" class="btn primary" data-act="retry">${icon('repeat', { size: 16 })}أعد المرحلة</button>
          ${attempts >= 2 ? `<button type="button" class="btn" data-act="to-read">${icon('book', { size: 16 })}ارجع للقراءة بالنظر</button>` : ''}
          <button type="button" class="btn ghost" data-act="next">كمّل على أي حال</button>
        </div>`;
      focusNext();
    }
  }

  function focusNext() {
    stageEl.scrollIntoView({ block: 'nearest' });
    stageEl.querySelector('.btn.primary')?.focus({ preventScroll: true });
  }

  function nextLabel() {
    const list = stagesFor(k, ayahs[k]);
    if (stageIdx + 1 < list.length) return `التالي: ${STAGES[list[stageIdx + 1]].name}`;
    return k + 1 < ayahs.length ? `الآية التالية (${ar(k + 2)})` : 'النتيجة والمقارنة';
  }

  function next() {
    attempts = 0;
    const list = stagesFor(k, ayahs[k]);
    if (stageIdx + 1 < list.length) { stageIdx++; startStage(); return; }
    if (k + 1 < ayahs.length) { k++; stageIdx = 0; startStage(); window.scrollTo({ top: 0 }); return; }
    showSummary();
  }

  // ---- المقارنة بين القراءة بالنظر والتسميع من الحفظ ----
  function classify(list) {
    const memWeak = [];
    const readHard = [];
    for (const g of list) {
      ayahWords(g).forEach((w, i) => {
        const word = { ...w, g, w: i };
        const key = keyOf(word);
        const m = memory.get(key);
        if (readMiss.get(key)) readHard.push(word);
        else if (m && m.miss) memWeak.push(word);
      });
    }
    return { memWeak, readHard };
  }

  function wordChips(list) {
    return list.map((w) => `<mark>${w.text}</mark>`).join('، ');
  }

  function comparisonFor(list) {
    const { memWeak, readHard } = classify(list);
    if (!memWeak.length && !readHard.length) return '';
    return `<div class="compare">
      ${memWeak.length ? `<p><span class="tag wrong">من الحفظ</span> صح وانت بتقرأ وغلط من حفظك: ${wordChips(memWeak)}</p>` : ''}
      ${readHard.length ? `<p><span class="tag soft">نطق</span> صعبة حتى وانت بتقرأ: ${wordChips(readHard)}</p>` : ''}
    </div>`;
  }

  function showSummary() {
    rec.destroy();
    stopAudio();
    stepperEl.innerHTML = '';
    stageEl.hidden = true;
    document.getElementById('mushaf').hidden = true;
    document.getElementById('dock').hidden = true;

    const readVals = [...readMiss.values()];
    const readAcc = readVals.length ? Math.round((readVals.filter((x) => !x).length / readVals.length) * 100) : 0;
    const memTotal = memScores.reduce((n, x) => n + x.done, 0);
    const memMist = memScores.reduce((n, x) => n + x.mistakes, 0);
    const memAcc = memTotal ? Math.round(((memTotal - memMist) / memTotal) * 100) : 0;
    const { memWeak, readHard } = classify(ayahs);
    recordPractice({ label: 'حفّظني', score: { total: memTotal, done: memTotal, mistakes: memMist, accuracy: memAcc } });

    const sum = document.getElementById('summary');
    sum.innerHTML = `<section class="card result" aria-labelledby="sum-title">
      <h2 id="sum-title">${icon('award')}خلّصت مراحل الحفظ</h2>
      <div class="compare-grid">
        <div><span class="muted small">وانت بتقرأ بالنظر</span><b>${ar(readAcc)}٪</b></div>
        <div><span class="muted small">من حفظك</span><b class="${memAcc < readAcc - 10 ? 'low' : ''}">${ar(memAcc)}٪</b></div>
      </div>
      <p class="muted small">${memAcc >= readAcc - 5
        ? 'تسميعك من الحفظ قريب من قراءتك بالنظر — الحفظ ثابت إن شاء الله.'
        : 'فيه فرق بين قراءتك بالنظر وتسميعك من الحفظ — الكلمات دي محتاجة تثبيت.'}</p>
      ${memWeak.length ? `<h3>${icon('target', { size: 18 })}نقاط ضعف في الحفظ (اتسجلت للمراجعة)</h3>
        <p class="muted small">قرأتها صح والمصحف مفتوح، لكن غلطت فيها من حفظك.</p>
        <ul class="mistake-list">${memWeak.map(contextLine).join('')}</ul>` : ''}
      ${readHard.length ? `<h3>${icon('headphones', { size: 18 })}راجع نطقها</h3>
        <p class="muted small">تعثرت فيها حتى وانت بتقرأ — غالباً نطق أو البرنامج مش بيفهمها، فمش هتتحسب عليك خطأ حفظ. اسمعها من القارئ.</p>
        <ul class="mistake-list">${readHard.map(contextLine).join('')}</ul>` : ''}
      ${!memWeak.length && !readHard.length ? `<p class="verdict ok">${icon('checkCircle')}<span>لا فرق بين قراءتك وتسميعك — ما شاء الله!</span></p>` : ''}
      <p>الخطوة الأخيرة: سمّع الورد كله من حفظك لاعتماده.</p>
      <div class="row actions">
        <button type="button" class="btn primary big" data-act="final">${icon('mic')}التسميع النهائي</button>
        <button type="button" class="btn ghost" data-act="back">لاحقاً</button>
      </div>
    </section>`;
    sum.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  function contextLine(w) {
    const { s, a } = fromGlobal(w.g);
    const all = ayahWords(w.g);
    const from = Math.max(0, w.w - 2);
    const ctxText = all.slice(from, w.w + 3).map((y, i) => (from + i === w.w ? `<mark>${y.text}</mark>` : y.text)).join(' ');
    return `<li><span class="q">${ctxText}</span><span class="muted small">${surahName(s)} ${ar(a)}</span></li>`;
  }

  function readerName(id) {
    return { Husary_128kbps: 'الحصري', Husary_Muallim_128kbps: 'الحصري (المعلم)', Minshawy_Murattal_128kbps: 'المنشاوي', Alafasy_128kbps: 'العفاسي', Abdul_Basit_Murattal_192kbps: 'عبد الباسط' }[id] || id;
  }

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') back();
    if (act === 'play') play(ayahs[k], reps);
    if (act === 'next') next();
    if (act === 'retry') startStage();
    if (act === 'to-read') { attempts = 0; stageIdx = stagesFor(k, ayahs[k]).indexOf('read'); startStage(); }
    if (act === 'final') onFinal();
  };

  setCleanup(() => { clearTimer(); stopAudio(); fixer.stop(); rec.destroy(); });
  startStage();
}
