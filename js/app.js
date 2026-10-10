import {
  loadQuran, surahName, ayahCount, toGlobal, fromGlobal, ayahWords, ayahText,
  describeAyahs, toArabicDigits, surahRangeLabel,
} from './quran.js';
import { getState, update, save, dayKey, formatDay, exportData, importData, resetAll, DEFAULT_SETTINGS } from './store.js';
import { todayPlan, recordSession, recordPractice, isReadIssue, stats, projection, dueWeak, weakAyahs, UNIT_LABEL, WEAK_INTERVALS } from './plan.js';
import { STATUS, isMistake } from './matcher.js';
import { speechSupported } from './speech.js';
import { Recitation, STATUS_LABEL, wordsOf } from './recitation.js';
import { icon } from './icons.js';
import { renderGuided } from './guided.js';

const app = document.getElementById('app');
const tabs = document.getElementById('tabs');
let cleanup = null;

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const RECITERS = {
  Husary_128kbps: 'الحصري (مرتل)',
  Husary_Muallim_128kbps: 'الحصري (المعلم)',
  Minshawy_Murattal_128kbps: 'المنشاوي',
  Alafasy_128kbps: 'العفاسي',
  Abdul_Basit_Murattal_192kbps: 'عبد الباسط (مرتل)',
};

const ar = toArabicDigits;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollBehavior = () => (reduceMotion() ? 'auto' : 'smooth');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- التنقل ----------
// كل شاشة لها مدخل في سجل المتصفح حتى يعمل زر الرجوع في الموبايل
const TAB_VIEWS = ['home', 'weak', 'free', 'plan'];

function go(view, params = {}, { push = true } = {}) {
  if (cleanup) { cleanup(); cleanup = null; }
  const tab = TAB_VIEWS.includes(view) ? view : null;
  for (const b of tabs.querySelectorAll('button')) {
    if (b.dataset.view === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  // شاشتا الحفظ والتسميع تملآن الشاشة ويحل شريط التحكم محل شريط التنقل
  document.body.classList.toggle('immersive', !tab);
  if (push && location.hash !== `#${view}`) history.pushState({ view }, '', `#${view}`);
  window.scrollTo(0, 0);
  const views = { home: renderHome, weak: renderWeak, free: renderFree, plan: renderPlan, study: renderStudy, recite: renderRecite, guided: renderGuidedView };
  views[view](params);
  refreshBadge();
}

// الرجوع من الشاشات الفرعية: نستخدم سجل المتصفح لو أمكن
function back(fallback = 'home') {
  if (history.state?.view && history.length > 1) history.back();
  else go(fallback);
}

window.addEventListener('popstate', (e) => {
  const view = e.state?.view ?? location.hash.slice(1);
  // شاشتا الحفظ والتسميع تحتاجان بيانات لا تُحفظ في السجل → نرجع للرئيسية
  go(TAB_VIEWS.includes(view) ? view : 'home', {}, { push: false });
});

tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});

function refreshBadge() {
  const n = dueWeak().length;
  const badge = document.getElementById('weak-badge');
  badge.hidden = !n;
  badge.textContent = ar(n);
}

// ================= الصفحة الرئيسية =================
function renderHome() {
  const st = getState();
  if (!st.setupDone) return renderPlan({ welcome: true });
  const plan = todayPlan();
  const s = stats();
  const weakTask = plan.tasks.find((t) => t.id === 'weak');
  const isStudyDay = st.settings.studyDays.includes(new Date().getDay());

  const taskCard = (t) => {
    let range;
    let actions = '';
    if (!t.ayahs.length) {
      const empty = {
        weak: 'لا توجد نقاط ضعف مستحقة اليوم',
        new: isStudyDay ? 'ما شاء الله! أتممت كل آيات الخطة' : 'اليوم يوم مراجعة فقط (لا حفظ جديد)',
        near: 'لا يوجد حفظ قريب بعد — سيظهر هنا ما تحفظه',
        far: 'سيظهر هنا محفوظك القديم بعد أن تحفظ',
      };
      range = `<p class="muted small empty">${empty[t.id]}</p>`;
    } else {
      range = `<p class="range">${esc(describeAyahs(t.ayahs))} <span class="muted small">· ${ar(t.ayahs.length)} آية</span></p>`;
      if (t.id === 'new' && !t.done) {
        actions = `<button type="button" class="btn primary" data-act="guided">${icon('sprout')}حفّظني خطوة بخطوة</button>
                   <button type="button" class="btn" data-act="study">${icon('headphones')}استمع</button>
                   <button type="button" class="btn" data-act="recite" data-task="new">${icon('mic')}سمّع</button>`;
      } else {
        actions = `<button type="button" class="btn ${t.done ? '' : 'primary'}" data-act="recite" data-task="${t.id}">${icon(t.done ? 'repeat' : 'mic')}${t.done ? 'سمّع مرة أخرى' : 'سمّع'}</button>`;
      }
      if (t.done && t.accuracy != null) actions += ` <span class="tag ok">${icon('check', { size: 14 })}بإتقان ${ar(t.accuracy)}٪</span>`;
    }
    return `<section class="card task ${t.done ? 'done' : ''} ${t.ayahs.length ? '' : 'idle'}" aria-label="${t.title}${t.done ? ' — تمت' : ''}">
      <div class="task-icon ${t.id}">${icon(t.done ? 'checkCircle' : t.icon, { size: 22 })}</div>
      <div class="body">
        <h2 class="task-title">${t.title}${t.id === 'weak' && t.count ? ` <span class="badge">${ar(t.count)} كلمة</span>` : ''}</h2>
        <p class="muted small">${t.desc}</p>
        ${range}
        ${actions ? `<div class="row actions">${actions}</div>` : ''}
      </div>
    </section>`;
  };

  const pending = plan.tasks.filter((t) => t.ayahs.length && !t.done).length;

  app.innerHTML = `
    <header class="page-head">
      <h1>${formatDay(plan.today)}</h1>
      <p class="muted">${pending ? `باقي لك ${ar(pending)} ${pending === 1 ? 'مهمة' : 'مهام'} اليوم` : 'أتممت ورد اليوم، بارك الله فيك'}</p>
    </header>
    ${weakTask.count ? `<div class="alert" role="note">${icon('bell')}<div><b>تذكير:</b> عندك <b>${ar(weakTask.count)}</b> كلمة أخطأت فيها أو نسيتها من قبل وحان وقت مراجعتها. ابدأ بها قبل أي شيء.</div></div>` : ''}
    <div class="stats">
      <div class="stat"><b>${ar(s.ayahs)}</b><span>آية محفوظة</span></div>
      <div class="stat"><b>${ar(s.pages.toFixed(1))}</b><span>صفحة تقريباً</span></div>
      <div class="stat"><b>${icon('flame', { size: 18, cls: 'flame' })}${ar(s.streak)}</b><span>يوم متتالٍ</span></div>
      <div class="stat"><b>${ar(s.weakActive)}</b><span>نقطة ضعف تحت المتابعة</span></div>
    </div>
    <div class="card progress-card">
      <div class="row small"><span>التقدم في حفظ القرآن</span><span class="spacer"></span><b>${ar(s.percent.toFixed(1))}٪</b></div>
      <div class="progress" role="progressbar" aria-label="التقدم في حفظ القرآن" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent.toFixed(1)}"><i style="width:${Math.min(100, s.percent)}%"></i></div>
    </div>
    ${plan.tasks.map(taskCard).join('')}
    ${recentSessions()}
  `;

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'study') go('study');
    if (b.dataset.act === 'guided') go('guided');
    if (b.dataset.act === 'recite') {
      const t = plan.tasks.find((x) => x.id === b.dataset.task);
      go('recite', { taskId: t.id, label: t.title, ayahs: t.ayahs });
    }
  };
}

function recentSessions() {
  const list = getState().sessions.slice(0, 8);
  if (!list.length) return '';
  return `<section class="card"><h2>آخر جلسات التسميع</h2><ul class="mistake-list">
    ${list.map((x) => `<li><span>${esc(x.label)}</span><span class="spacer"></span>
      <span class="tag ${x.accuracy >= 90 ? 'ok' : x.accuracy >= 70 ? 'corrected' : 'wrong'}">${ar(x.accuracy)}٪</span>
      <span class="muted small">${ar(x.mistakes)} خطأ · ${formatDay(x.date)}</span></li>`).join('')}
  </ul></section>`;
}

// ================= شاشة الحفظ (قبل التسميع) =================
let audio = null;

function renderStudy() {
  const plan = todayPlan();
  const t = plan.tasks.find((x) => x.id === 'new');
  const weak = getState().weak;
  const reciter = getState().settings.reciter;
  let html = '';
  let lastS = 0;
  for (const g of t.ayahs) {
    const { s, a } = fromGlobal(g);
    if (s !== lastS) { html += `<span class="surah-head">سورة ${surahName(s)}</span>`; lastS = s; }
    html += ayahWords(g).map((w, i) => {
      const wk = weak[`${g}:${i}`];
      return `<span class="w ${wk && !wk.mastered ? 'weak' : ''}">${w.text}</span>`;
    }).join(' ');
    html += ` <span class="ayah-end">﴿${ar(a)}﴾</span><button type="button" class="ayah-play" data-g="${g}" aria-label="استمع للآية ${ar(a)}">${icon('play', { size: 14 })}</button> `;
  }

  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>الحفظ الجديد</h1><p class="muted small">${esc(describeAyahs(t.ayahs))}</p></div>
    </div>
    <details class="card tip">
      <summary>${icon('info', { size: 18 })}طريقة الحفظ المقترحة</summary>
      <ol>
        <li>استمع للآية ٣ مرات وأنت تنظر للمصحف.</li>
        <li>اقرأها ٥ مرات، ثم اقرأها مغمض العينين.</li>
        <li>بعد ما تثبت كل الآيات اربطها ببعض.</li>
        <li>اضغط «سمّع» — لازم تحقق ${ar(getState().settings.passMark)}٪ لاعتماد الحفظ.</li>
      </ol>
    </details>
    <div class="player card">
      <label class="inline-field">تكرار كل آية
        <select id="repeat">${[1, 3, 5, 10].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${ar(n)} ${n > 2 && n < 11 ? 'مرات' : 'مرة'}</option>`).join('')}</select>
      </label>
      <button type="button" class="btn" data-act="play-all" id="play-all">${icon('play', { size: 16 })}<span>استمع للورد كله</span></button>
      <p class="muted small">القارئ: ${RECITERS[reciter] || reciter}</p>
    </div>
    <div class="mushaf study">${html}</div>
    <div class="dock"><div class="inner">
      <p class="heard">لما تحس إنك حفظت، ابدأ التسميع والنص هيكون مخفي.</p>
      <button type="button" class="btn big" data-act="guided">${icon('sprout')}حفّظني</button>
      <button type="button" class="btn primary big" data-act="recite">${icon('mic')}جاهز — سمّع</button>
    </div></div>
  `;

  const playAllBtn = document.getElementById('play-all');
  const setPlayAll = (playing) => {
    playAllBtn.dataset.act = playing ? 'stop' : 'play-all';
    playAllBtn.innerHTML = playing ? `${icon('stop', { size: 16 })}<span>إيقاف</span>` : `${icon('play', { size: 16 })}<span>استمع للورد كله</span>`;
  };
  const stopAudio = () => {
    if (audio) { audio.pause(); audio = null; }
    app.querySelectorAll('.ayah-play.playing').forEach((b) => { b.classList.remove('playing'); b.innerHTML = icon('play', { size: 14 }); });
    setPlayAll(false);
  };

  // تشغيل قائمة آيات مع تكرار كل آية
  const playQueue = (list) => {
    stopAudio();
    const rep = Number(document.getElementById('repeat').value);
    const queue = list.flatMap((g) => Array(rep).fill(g));
    const next = () => {
      const g = queue.shift();
      app.querySelectorAll('.ayah-play.playing').forEach((b) => { b.classList.remove('playing'); b.innerHTML = icon('play', { size: 14 }); });
      if (g == null) { audio = null; setPlayAll(false); return; }
      setPlayAll(true);
      const { s, a } = fromGlobal(g);
      const btn = app.querySelector(`.ayah-play[data-g="${g}"]`);
      if (btn) { btn.classList.add('playing'); btn.innerHTML = icon('pause', { size: 14 }); }
      const el = new Audio(`https://everyayah.com/data/${reciter}/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`);
      audio = el;
      el.onended = () => { if (audio === el) next(); };
      el.onerror = () => { toast('تعذر تشغيل الصوت — تأكد من الاتصال بالإنترنت'); stopAudio(); };
      el.play().catch(() => {});
    };
    next();
  };

  app.onclick = (e) => {
    const p = e.target.closest('.ayah-play');
    if (p) return p.classList.contains('playing') ? stopAudio() : playQueue([Number(p.dataset.g)]);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') back();
    if (act === 'play-all') playQueue(t.ayahs);
    if (act === 'stop') stopAudio();
    if (act === 'recite') go('recite', { taskId: 'new', label: 'الحفظ الجديد', ayahs: t.ayahs });
    if (act === 'guided') go('guided');
  };
  cleanup = stopAudio;
}

// ================= حفّظني =================
// بدون معاملات: ورد اليوم الجديد
function renderGuidedView({ ayahs, label, returnTo = 'home' } = {}) {
  const isNew = !ayahs;
  if (isNew) ayahs = todayPlan().tasks.find((x) => x.id === 'new').ayahs;
  if (!ayahs.length) { go('home', {}, { push: false }); return; }
  renderGuided({
    app, toast,
    back: () => back(returnTo),
    setCleanup: (fn) => { cleanup = fn; },
    onFinal: () => go('recite', isNew
      ? { taskId: 'new', label: 'الحفظ الجديد', ayahs }
      : { taskId: 'free', label: label || 'تسميع حر', ayahs, returnTo }),
  }, { ayahs, label: label || 'حفّظني' });
}

// ================= شاشة التسميع =================
// reading = true: القراءة والمصحف مفتوح (للمقارنة) — لا تُحسب أخطاؤها أخطاء حفظ
function renderRecite({ taskId, label, ayahs, returnTo = 'home', reading = false }) {
  const st = getState();
  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>${esc(label)}</h1><p class="muted small">${esc(describeAyahs(ayahs))}</p></div>
      <span id="score" class="tag ok"></span>
    </div>
    <div class="progress" id="bar-wrap" role="progressbar" aria-label="نسبة ما سمّعته" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="bar" style="width:0"></i></div>
    ${!speechSupported ? `<div class="alert" role="note">${icon('info')}<div>متصفحك لا يدعم التعرف على الصوت. استخدم Chrome أو Edge أو Safari للتسميع بالصوت.
      الآن تقدر تسمّع بنفسك: اضغط <b>«قلتها صح»</b> لكشف الكلمة، أو <b>«نسيتها»</b> لو نسيت.</div></div>` : ''}
    ${reading ? `<div class="alert info" role="note">${icon('book')}<div><b>قراءة بالنظر:</b> اقرأ والمصحف مفتوح. الكلمات اللي تتعثر فيها هنا
      غالباً مشكلة نطق أو البرنامج مش بيفهمها — مش هتتحسب عليك أخطاء حفظ وقت التسميع.</div></div>` : `<ul class="legend" aria-label="دليل الألوان">
      <li><i class="sw hidden"></i>مخفية</li>
      <li><i class="sw wrong"></i>خطأ / أسقطها</li>
      <li><i class="sw hint"></i>نسيتها</li>
      <li><i class="sw corrected"></i>تردد</li>
      ${st.settings.warnWeak ? '<li><i class="sw weak"></i>أخطأت فيها سابقاً — ركّز</li>' : ''}
    </ul>`}
    <div class="mushaf" id="mushaf" aria-label="نص الآيات">${''}</div>
    <p class="muted small helper">${icon('info', { size: 16 })}لو البرنامج فهمك غلط، اضغط على الكلمة الملونة لتصحيحها (والعكس).</p>
    <div id="result" tabindex="-1"></div>
    <div class="dock" id="dock"></div>
  `;

  const rec = new Recitation({
    mushafEl: document.getElementById('mushaf'),
    dockEl: document.getElementById('dock'),
    lang: st.settings.lang,
    weak: st.weak,
    warnWeak: st.settings.warnWeak && !reading,
    onError: (msg) => toast(msg, 5000),
    onUpdate: (sc) => {
      const pct = Math.round((sc.done / sc.total) * 100);
      document.getElementById('bar').style.width = `${pct}%`;
      document.getElementById('bar-wrap').setAttribute('aria-valuenow', pct);
      const scoreEl = document.getElementById('score');
      scoreEl.textContent = sc.done ? `${ar(sc.accuracy)}٪ · ${ar(sc.mistakes)} خطأ` : '';
      scoreEl.className = `tag ${sc.accuracy >= 90 ? 'ok' : sc.accuracy >= 70 ? 'corrected' : 'wrong'}`;
    },
    onComplete: () => finish(),
    onFinishRequest: () => {
      if (rec.matcher.pos === 0 || confirm('إنهاء التسميع الآن؟ سيتم حفظ ما سمّعته حتى الآن.')) finish();
    },
  });
  rec.load({ ayahs, visible: () => reading, reading });
  const words = rec.words;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    rec.destroy();
    const sc = rec.score;
    if (!sc.done) { back(returnTo); return; }
    const status = rec.status.slice();
    // نحسب الكلمات الصعبة في القراءة قبل التسجيل حتى لا تتأثر بنتيجة هذه الجلسة
    const readIssue = status.map((x, i) => isMistake(x) && isReadIssue(words[i].g, words[i].w));
    recordSession({ taskId, label, words, status, score: sc, reading });
    refreshBadge();
    const mistakes = status.map((x, i) => ({ x, i })).filter((o) => isMistake(o.x));
    const passMark = getState().settings.passMark;
    let verdict = '';
    if (taskId === 'new' && !reading) {
      verdict = sc.done === sc.total && sc.accuracy >= passMark
        ? `<p class="verdict ok">${icon('checkCircle')}<span>تم اعتماد الحفظ الجديد. ستظهر هذه الآيات في المراجعة القريبة الأيام القادمة.</span></p>`
        : `<p class="verdict warn">${icon('alert')}<span>تحتاج ${ar(passMark)}٪ على الأقل مع إكمال الورد لاعتماد الحفظ. راجع المواضع الملونة وأعد التسميع.</span></p>`;
    }
    const memoryCount = mistakes.filter(({ i }) => !readIssue[i]).length;
    document.getElementById('dock').hidden = true;
    const res = document.getElementById('result');
    res.innerHTML = `<section class="card result" aria-labelledby="result-title">
      <div class="result-top">
        <div class="result-score ${sc.accuracy < 80 ? 'low' : ''}">${ar(sc.accuracy)}٪</div>
        <div><h2 id="result-title">${reading ? 'نتيجة القراءة بالنظر' : sc.accuracy >= 95 ? 'ممتاز، بارك الله فيك' : sc.accuracy >= 80 ? 'جيد، ثبّت المواضع الملونة' : 'تحتاج تثبيتاً أكثر'}</h2>
        <p class="muted small">${ar(sc.done)} من ${ar(sc.total)} كلمة · ${ar(sc.mistakes)} خطأ</p></div>
      </div>
      ${verdict}
      ${mistakes.length ? `<h3>${reading ? 'كلمات تعثرت فيها وانت بتقرأ' : memoryCount ? 'حفظتُ لك هذه المواضع للمراجعة' : 'المواضع الملونة'}</h3>
      <ul class="mistake-list">${mistakes.map(({ x, i }) => mistakeItem(words[i], x, readIssue[i] && !reading)).join('')}</ul>
      <p class="muted small">${reading
        ? 'دي غالباً مشكلة نطق أو البرنامج مش بيفهمها. اسمعها من القارئ وصحّح نطقها، ووقت التسميع لو "غلط" فيها مش هتتحسب خطأ حفظ.'
        : 'ستظهر لك في «نقاط الضعف» غداً، ثم بعد يومين، ثم ٤، ثم أسبوع… حتى تثبت تماماً.'}</p>`
      : `<p class="verdict ok">${icon('award')}<span>لا أخطاء، ما شاء الله!</span></p>`}
      <div class="row actions">
        <button type="button" class="btn primary" data-act="again">${icon('repeat')}${reading ? 'اقرأ مرة أخرى' : 'سمّع مرة أخرى'}</button>
        ${reading ? `<button type="button" class="btn" data-act="to-memory">${icon('mic')}سمّعها من حفظك</button>` : ''}
        ${mistakes.length && !reading ? `<button type="button" class="btn" data-act="again-weak">${icon('target')}آيات الأخطاء فقط</button>` : ''}
        <button type="button" class="btn ghost" data-act="back">رجوع</button>
      </div>
    </section>`;
    // ننقل التركيز للنتيجة حتى يقرأها قارئ الشاشة ولا يضيع التركيز مع اختفاء شريط التحكم
    res.focus({ preventScroll: true });
    res.scrollIntoView({ behavior: scrollBehavior() });
    res.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'again') go('recite', { taskId, label, ayahs, returnTo, reading });
      if (b.dataset.act === 'to-memory') go('recite', { taskId: 'free', label: 'تسميع حر', ayahs, returnTo });
      if (b.dataset.act === 'again-weak') {
        const list = [...new Set(mistakes.map(({ i }) => words[i].g))];
        go('recite', { taskId: 'weak', label: 'آيات الأخطاء', ayahs: list, returnTo });
      }
      if (b.dataset.act === 'back') back(returnTo);
    };
  }

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.closest('#result') && b.dataset.act === 'back') back(returnTo);
  };
  cleanup = () => { finished = true; rec.destroy(); };
}

// سطر في قائمة الأخطاء: الكلمة في سياقها
function mistakeItem(w, x, readIssue = false) {
  const { s, a } = fromGlobal(w.g);
  const all = ayahWords(w.g);
  const from = Math.max(0, w.w - 2);
  const ctx = all.slice(from, w.w + 3).map((y, k) => (from + k === w.w ? `<mark>${y.text}</mark>` : y.text)).join(' ');
  return `<li><span class="tag ${x}">${STATUS_LABEL[x]}</span><span class="q">${ctx}</span><span class="muted small">${surahName(s)} ${ar(a)}</span>
    ${readIssue ? '<span class="tag soft" title="البرنامج بيغلط فيها حتى وانت بتقرأ بالنظر">صعبة في القراءة كمان — مش محسوبة خطأ حفظ</span>' : ''}</li>`;
}

// ================= نقاط الضعف =================
function renderWeak() {
  const st = getState();
  const today = dayKey();
  const items = Object.values(st.weak);
  const active = items.filter((w) => !w.mastered);
  const due = dueWeak();
  const byAyah = new Map();
  for (const w of active) {
    if (!byAyah.has(w.g)) byAyah.set(w.g, []);
    byAyah.get(w.g).push(w);
  }
  const groups = [...byAyah.entries()].sort((a, b) => {
    const da = Math.min(...a[1].map((x) => (x.due <= today ? 0 : 1)));
    const db = Math.min(...b[1].map((x) => (x.due <= today ? 0 : 1)));
    return da - db || b[1].reduce((n, x) => n + x.misses, 0) - a[1].reduce((n, x) => n + x.misses, 0);
  });

  const ayahCard = ([g, list]) => {
    const { s, a } = fromGlobal(g);
    const set = new Set(list.map((x) => x.w));
    const text = ayahWords(g).map((w, i) => (set.has(i) ? `<span class="weak">${w.text}</span>` : w.text)).join(' ');
    const misses = list.reduce((n, x) => n + x.misses, 0);
    const box = Math.min(...list.map((x) => x.box || 0));
    const nextDue = list.map((x) => x.due).sort()[0];
    const isDue = nextDue <= today;
    return `<article class="card weak-ayah ${isDue ? 'is-due' : ''}">
      <header class="weak-meta">
        <h2>${surahName(s)} ${ar(a)}</h2>
        <span class="tag wrong">${ar(misses)} ${misses === 1 ? 'خطأ' : 'أخطاء'}</span>
        <span class="boxes" role="img" aria-label="مرحلة التثبيت ${ar(box)} من ${ar(WEAK_INTERVALS.length)}" title="مراحل التثبيت">${WEAK_INTERVALS.map((_, k) => `<i class="${k < box ? 'on' : ''}"></i>`).join('')}</span>
        <span class="due ${isDue ? 'now' : 'muted'}">${isDue ? `${icon('bell', { size: 14 })}مستحقة الآن` : `المراجعة: ${formatDay(nextDue)}`}</span>
      </header>
      <p class="q">${text}</p>
      <div class="row actions">
        <button type="button" class="btn ${isDue ? 'primary' : ''}" data-act="one" data-g="${g}">${icon('mic')}سمّعها</button>
        <button type="button" class="btn ghost danger" data-act="del" data-g="${g}">${icon('trash', { size: 18 })}إزالة</button>
      </div>
    </article>`;
  };

  app.innerHTML = `
    <header class="page-head">
      <h1>نقاط الضعف</h1>
      <p class="muted">كل كلمة تخطئ فيها أو تنساها أو تتردد فيها تُحفظ هنا، وتظهر لك على فترات متباعدة
        (${WEAK_INTERVALS.map(ar).join('، ')} يوم). كل مرة تقرأها صح تنتقل لمرحلة أبعد، ولو أخطأت ترجع من الأول.</p>
    </header>
    <div class="stats three">
      <div class="stat"><b>${ar(due.length)}</b><span>مستحقة اليوم</span></div>
      <div class="stat"><b>${ar(active.length)}</b><span>تحت المتابعة</span></div>
      <div class="stat"><b>${ar(items.length - active.length)}</b><span>ثبتت والحمد لله</span></div>
    </div>
    ${groups.length ? `<div class="row actions page-actions">
      ${due.length ? `<button type="button" class="btn primary" data-act="due">${icon('target')}سمّع المستحق الآن · ${ar(weakAyahs(due).length)} آية</button>` : ''}
      <button type="button" class="btn" data-act="all">${icon('layers')}سمّع كل نقاط الضعف</button>
    </div>
    ${groups.map(ayahCard).join('')}` : `<div class="card empty-state">${icon('award', { size: 40 })}<h2>لا توجد نقاط ضعف</h2>
      <p class="muted">ابدأ التسميع وسيتابع البرنامج أخطاءك تلقائياً.</p>
      <button type="button" class="btn primary" data-act="home">${icon('today')}ورد اليوم</button></div>`}
  `;

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'due') go('recite', { taskId: 'weak', label: 'نقاط الضعف', ayahs: weakAyahs(due), returnTo: 'weak' });
    if (act === 'all') go('recite', { taskId: 'weak-all', label: 'كل نقاط الضعف', ayahs: [...byAyah.keys()].sort((x, y) => x - y).slice(0, 30), returnTo: 'weak' });
    if (act === 'one') go('recite', { taskId: 'weak-one', label: 'نقطة ضعف', ayahs: [Number(b.dataset.g)], returnTo: 'weak' });
    if (act === 'home') go('home');
    if (act === 'del') {
      if (!confirm('إزالة هذه الآية من نقاط الضعف؟ لن تظهر لك للمراجعة بعد ذلك.')) return;
      const g = Number(b.dataset.g);
      update((s) => { for (const k of Object.keys(s.weak)) if (s.weak[k].g === g) delete s.weak[k]; });
      go('weak');
    }
  };
}

// ================= تسميع حر =================
function surahOptions(selected) {
  let out = '';
  for (let s = 1; s <= 114; s++) out += `<option value="${s}" ${s === selected ? 'selected' : ''}>${ar(s)}. ${surahName(s)}</option>`;
  return out;
}

function renderFree() {
  const last = JSON.parse(localStorage.getItem('free-last') || '{"s":1,"from":1,"to":7}');
  app.innerHTML = `
    <header class="page-head">
      <h1>تسميع حر</h1>
      <p class="muted">اختر أي سورة أو مقطع وسمّعه. الأخطاء هنا أيضاً تُضاف لنقاط الضعف.</p>
    </header>
    <form class="card form" id="free-form">
      <label class="field"><span>السورة</span><select id="fs">${surahOptions(last.s)}</select></label>
      <div class="field-row">
        <label class="field"><span>من الآية</span><input type="number" id="ff" min="1" inputmode="numeric" value="${last.from}"></label>
        <label class="field"><span>إلى الآية</span><input type="number" id="ft" min="1" inputmode="numeric" value="${last.to}"></label>
      </div>
      <p class="muted small" id="fhelp"></p>
      <fieldset class="field">
        <legend>الطريقة</legend>
        <div class="segmented">
          <label><input type="radio" name="mode" value="memory" ${last.mode !== 'reading' && last.mode !== 'guided' ? 'checked' : ''}><span>${icon('mic', { size: 16 })}من حفظي</span></label>
          <label><input type="radio" name="mode" value="reading" ${last.mode === 'reading' ? 'checked' : ''}><span>${icon('book', { size: 16 })}بالنظر</span></label>
          <label><input type="radio" name="mode" value="guided" ${last.mode === 'guided' ? 'checked' : ''}><span>${icon('sprout', { size: 16 })}حفّظني</span></label>
        </div>
        <p class="muted small" id="mode-help"></p>
      </fieldset>
      <div class="row actions">
        <button type="submit" class="btn primary big">${icon('mic')}ابدأ</button>
        <button type="button" class="btn" id="fall">السورة كاملة</button>
      </div>
    </form>`;
  const fs = document.getElementById('fs');
  const ff = document.getElementById('ff');
  const ft = document.getElementById('ft');
  const clamp = () => {
    const n = ayahCount(Number(fs.value));
    ff.max = n; ft.max = n;
    if (Number(ft.value) > n) ft.value = n;
    if (Number(ff.value) > n) ff.value = 1;
    document.getElementById('fhelp').textContent = `سورة ${surahName(Number(fs.value))}: ${ar(n)} آية`;
  };
  ff.onchange = clamp;
  ft.onchange = clamp;
  const MODE_HELP = {
    memory: 'النص مخفي ويظهر مع قراءتك. الأخطاء تتسجل في نقاط الضعف.',
    reading: 'المصحف مفتوح وانت بتقرأ. بيعرف الكلمات الصعبة في النطق عشان ما تتحسبش عليك أخطاء حفظ بعد كده.',
    guided: 'آية آية: استمع ← اقرأ بالنظر ← إخفاء تدريجي ← من حفظك ← اربط، ثم مقارنة بين قراءتك وحفظك.',
  };
  const form = document.getElementById('free-form');
  const showMode = () => { document.getElementById('mode-help').textContent = MODE_HELP[form.mode.value]; };
  form.onchange = showMode;
  showMode();
  fs.onchange = () => { ff.value = 1; ft.value = ayahCount(Number(fs.value)); clamp(); };
  document.getElementById('fall').onclick = () => { ff.value = 1; ft.value = ayahCount(Number(fs.value)); };
  clamp();
  document.getElementById('free-form').onsubmit = (e) => {
    e.preventDefault();
    const s = Number(fs.value);
    let from = Math.max(1, Number(ff.value) || 1);
    let to = Math.min(ayahCount(s), Number(ft.value) || from);
    if (to < from) [from, to] = [to, from];
    const mode = form.mode.value;
    localStorage.setItem('free-last', JSON.stringify({ s, from, to, mode }));
    const ayahs = [];
    for (let a = from; a <= to; a++) ayahs.push(toGlobal(s, a));
    if (mode === 'guided') go('guided', { ayahs, label: `حفّظني — ${surahName(s)}`, returnTo: 'free' });
    else go('recite', { taskId: 'free', label: mode === 'reading' ? 'قراءة بالنظر' : 'تسميع حر', ayahs, returnTo: 'free', reading: mode === 'reading' });
  };
  app.onclick = null;
}

// ================= الخطة والإعدادات =================
function renderPlan({ welcome = false } = {}) {
  const st = getState();
  const s = st.settings;
  const unitOpts = (sel) => Object.entries(UNIT_LABEL).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  const prior = new Set(s.prior);

  const options = (list, sel, fmt) => list.map((n) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${fmt(n)}</option>`).join('');
  app.innerHTML = `
    ${welcome ? `<section class="card welcome">
      <img src="icons/icon.svg" alt="" width="56" height="56">
      <h1>أهلاً بك في رفيق الحفظ</h1>
      <p>خطة يومية فيها <b>حفظ جديد</b> و<b>مراجعة قريبة</b> و<b>مراجعة بعيدة</b> و<b>نقاط ضعفك</b>.
      وقت التسميع يكون النص مخفياً، وكل كلمة تقولها صح تظهر، ولو أخطأت أو نسيت يحفظها ويذكّرك بها حتى تثبت.</p>
      <p class="muted small">اضبط الخطة المناسبة لك — تقدر تغيرها في أي وقت.</p></section>`
    : '<header class="page-head"><h1>خطة الحفظ</h1></header>'}
    <form class="form" id="pf" novalidate>
      <fieldset class="card">
        <legend>${icon('sprout')}الحفظ الجديد</legend>
        <div class="field-row">
          <label class="field"><span>ابدأ من سورة</span><select name="startSurah">${surahOptions(s.startSurah)}</select></label>
          <label class="field"><span>الاتجاه</span><select name="direction">
            <option value="backward" ${s.direction === 'backward' ? 'selected' : ''}>نزولاً نحو الفاتحة (جزء عمّ أولاً)</option>
            <option value="forward" ${s.direction === 'forward' ? 'selected' : ''}>صعوداً نحو الناس</option>
          </select></label>
        </div>
        <div class="field">
          <span id="amount-label">المقدار اليومي</span>
          <div class="combo" role="group" aria-labelledby="amount-label">
            <input type="number" name="amount" min="0.5" step="0.5" inputmode="decimal" value="${s.amount}" aria-label="المقدار">
            <select name="unit" aria-label="الوحدة">${unitOpts(s.unit)}</select>
          </div>
        </div>
        <fieldset class="field" aria-describedby="days-help days-error">
          <legend>أيام الحفظ الجديد</legend>
          <div class="chips">${WEEKDAYS.map((d, i) => `<label class="chip"><input type="checkbox" name="day" value="${i}" ${s.studyDays.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
          <p class="muted small" id="days-help">الأيام غير المختارة تكون للمراجعة فقط.</p>
          <p class="error small" id="days-error" hidden>${icon('alert', { size: 16 })}اختر يوماً واحداً على الأقل للحفظ.</p>
        </fieldset>
        <label class="field"><span>نسبة الإتقان المطلوبة لاعتماد الحفظ</span>
          <select name="passMark">${options([80, 85, 90, 95, 100], s.passMark, (n) => `${ar(n)}٪`)}</select></label>
      </fieldset>

      <fieldset class="card">
        <legend>${icon('repeat')}المراجعة</legend>
        <div class="field-row">
          <label class="field"><span>المراجعة القريبة: ما حفظته في آخر</span>
            <select name="nearDays">${options([3, 5, 7, 10, 14, 30], s.nearDays, (n) => `${ar(n)} أيام`)}</select></label>
          <div class="field">
            <span id="far-label">المراجعة البعيدة يومياً</span>
            <div class="combo" role="group" aria-labelledby="far-label">
              <input type="number" name="farAmount" min="0.5" step="0.5" inputmode="decimal" value="${s.farAmount}" aria-label="المقدار">
              <select name="farUnit" aria-label="الوحدة">${unitOpts(s.farUnit)}</select>
            </div>
          </div>
        </div>
        <details class="disclosure" ${welcome ? 'open' : ''}>
          <summary>سور حفظتها من قبل <span class="badge soft" id="prior-count">${ar(prior.size)}</span></summary>
          <p class="muted small">تدخل في المراجعة البعيدة ولا تظهر في الحفظ الجديد.</p>
          <div class="row">
            <button type="button" class="btn" data-act="juz30">تحديد جزء عمّ</button>
            <button type="button" class="btn ghost" data-act="clearprior">إلغاء الكل</button>
          </div>
          <div class="surah-grid chips">
            ${Array.from({ length: 114 }, (_, k) => k + 1).map((n) => `<label class="chip"><input type="checkbox" name="prior" value="${n}" ${prior.has(n) ? 'checked' : ''}><span>${surahName(n)}</span></label>`).join('')}
          </div>
        </details>
      </fieldset>

      <fieldset class="card">
        <legend>${icon('bell')}التسميع والتذكير</legend>
        <div class="field-row">
          <label class="field"><span>لهجة التعرف على الصوت</span><select name="lang">
            ${[['ar-SA', 'العربية (السعودية)'], ['ar-EG', 'العربية (مصر)'], ['ar-AE', 'العربية (الإمارات)'], ['ar-JO', 'العربية (الأردن)'], ['ar-MA', 'العربية (المغرب)']].map(([v, l]) => `<option value="${v}" ${v === s.lang ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <label class="field"><span>القارئ (للاستماع)</span><select name="reciter">
            ${Object.entries(RECITERS).map(([v, l]) => `<option value="${v}" ${v === s.reciter ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </div>
        <label class="switch"><input type="checkbox" name="warnWeak" ${s.warnWeak ? 'checked' : ''}><span class="track" aria-hidden="true"></span>
          <span>نبّهني على مواضع أخطائي السابقة وقت التسميع<small class="muted">خط برتقالي تحت الكلمة المخفية</small></span></label>
        <label class="switch"><input type="checkbox" name="reminders" ${s.reminders ? 'checked' : ''}><span class="track" aria-hidden="true"></span>
          <span>ذكّرني يومياً<small class="muted">إشعار والبرنامج مفتوح أو مثبّت على الشاشة الرئيسية</small></span></label>
        <div class="field-row">
          <label class="field"><span>وقت التذكير</span><input type="time" name="reminderTime" value="${s.reminderTime}"></label>
          <div class="field"><span aria-hidden="true">&nbsp;</span><button type="button" class="btn" data-act="ics">${icon('calendarPlus')}أضف التذكير للتقويم</button></div>
        </div>
        <p class="muted small">للتذكير المضمون حتى والبرنامج مغلق، أضفه لتقويم موبايلك.</p>
      </fieldset>

      <div class="card projection" id="proj" role="status" aria-live="polite"></div>
      <div class="form-submit"><button class="btn primary big block" type="submit">${icon('check')}${welcome ? 'ابدأ الخطة' : 'حفظ الخطة'}</button></div>
    </form>

    ${welcome ? '' : `<section class="card">
      <h2>نسخة احتياطية</h2>
      <p class="muted small">بياناتك محفوظة على هذا الجهاز فقط. صدّرها لنقلها لجهاز آخر.</p>
      <div class="row actions">
        <button type="button" class="btn" data-act="export">${icon('download')}تصدير</button>
        <label class="btn file-btn">${icon('upload')}استيراد<input type="file" id="imp" accept="application/json"></label>
      </div>
      <div class="danger-zone">
        <button type="button" class="btn ghost danger" data-act="reset">${icon('trash', { size: 18 })}مسح كل البيانات</button>
      </div>
    </section>`}
  `;

  const form = document.getElementById('pf');
  const read = () => {
    const fd = new FormData(form);
    return {
      ...s,
      startSurah: Number(fd.get('startSurah')),
      direction: fd.get('direction'),
      amount: Math.max(0.5, Number(fd.get('amount')) || 1),
      unit: fd.get('unit'),
      studyDays: fd.getAll('day').map(Number),
      passMark: Number(fd.get('passMark')),
      nearDays: Number(fd.get('nearDays')),
      farAmount: Math.max(0.5, Number(fd.get('farAmount')) || 1),
      farUnit: fd.get('farUnit'),
      prior: fd.getAll('prior').map(Number),
      lang: fd.get('lang'),
      reciter: fd.get('reciter'),
      warnWeak: fd.get('warnWeak') === 'on',
      reminders: fd.get('reminders') === 'on',
      reminderTime: fd.get('reminderTime') || '20:00',
    };
  };
  const showProj = () => {
    const p = projection(read());
    document.getElementById('proj').innerHTML = p.ayahs
      ? `<div class="proj-head">${icon('today')}<b>تقدير موعد الإتمام</b></div>
         <div class="proj-stats">
           <div><b>${ar(p.ayahs)}</b><span>آية متبقية</span></div>
           <div><b>${ar(p.studyDays)}</b><span>يوم حفظ</span></div>
           <div><b>${ar(Math.max(1, Math.round(p.calendarDays / 30)))}</b><span>شهر تقريباً</span></div>
         </div>
         <p class="small">تنتهي تقريباً <b>${formatDay(p.end)} ${ar(p.end.slice(0, 4))}</b> عند سورة ${surahName(p.last.s)}.</p>
         <p class="muted small">لختم القرآن كاملاً اجعل البداية من الناس نزولاً أو من الفاتحة صعوداً.</p>`
      : `<div class="proj-head">${icon('checkCircle')}<b>كل الآيات في اتجاه هذه الخطة محفوظة</b></div>`;
    document.getElementById('prior-count').textContent = ar(form.querySelectorAll('input[name=prior]:checked').length);
  };
  form.oninput = () => {
    showProj();
    if (form.querySelector('input[name=day]:checked')) document.getElementById('days-error').hidden = true;
  };
  showProj();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const next = read();
    if (!next.studyDays.length) {
      const err = document.getElementById('days-error');
      err.hidden = false;
      form.querySelector('input[name=day]').focus();
      err.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      return;
    }
    const today = dayKey();
    update((x) => {
      x.settings = next;
      x.setupDone = true;
      // إعادة بناء خطة اليوم لو لم يُعتمد حفظ اليوم بعد
      if (x.days[today] && !x.days[today].tasks.new.done) delete x.days[today];
    });
    if (next.reminders) await enableNotifications();
    toast('تم حفظ الخطة');
    go('home');
  };

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'juz30') {
      form.querySelectorAll('input[name=prior]').forEach((c) => { if (Number(c.value) >= 78) c.checked = true; });
      showProj();
    }
    if (act === 'clearprior') { form.querySelectorAll('input[name=prior]').forEach((c) => { c.checked = false; }); showProj(); }
    if (act === 'ics') downloadIcs(read().reminderTime);
    if (act === 'export') {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hifz-backup-${dayKey()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (act === 'reset' && confirm('سيتم مسح الخطة وكل التقدم ونقاط الضعف. متأكد؟')) { resetAll(); go('home'); }
  };
  const imp = document.getElementById('imp');
  if (imp) imp.onchange = async () => {
    try { importData(await imp.files[0].text()); toast('تم الاستيراد'); go('home'); } catch (err) { toast(`فشل الاستيراد: ${err.message}`); }
  };
}

// ================= التذكير =================
async function enableNotifications() {
  if (!('Notification' in window)) { toast('المتصفح لا يدعم الإشعارات — استخدم التقويم'); return; }
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') toast('لم يُسمح بالإشعارات — تقدر تضيف التذكير للتقويم');
}

async function notify(title, body) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon.svg', dir: 'rtl', lang: 'ar', tag: 'hifz-daily' });
    else new Notification(title, { body, dir: 'rtl' });
  } catch { /* ignore */ }
}

function checkReminder() {
  const st = getState();
  if (!st.setupDone || !st.settings.reminders) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const today = dayKey();
  if (st.lastReminder === today) return;
  const [h, m] = st.settings.reminderTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  const plan = todayPlan();
  const pending = plan.tasks.filter((t) => t.ayahs.length && !t.done);
  if (!pending.length) return;
  const weak = plan.tasks.find((t) => t.id === 'weak').count;
  update((x) => { x.lastReminder = today; });
  notify('ورد اليوم في انتظارك', `${pending.map((t) => t.title).join(' · ')}${weak ? `\nعندك ${weak} كلمة من نقاط ضعفك تحتاج مراجعة` : ''}`);
}

function downloadIcs(time) {
  const [h, m] = time.split(':');
  const d = dayKey().replace(/-/g, '');
  const url = location.href.split('#')[0];
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rafiq Al-Hifz//AR', 'BEGIN:VEVENT',
    `UID:hifz-daily-${d}@rafiq`, `DTSTAMP:${d}T000000Z`,
    `DTSTART:${d}T${h}${m}00`, 'DURATION:PT30M',
    'RRULE:FREQ=DAILY', 'SUMMARY:ورد حفظ القرآن',
    `DESCRIPTION:افتح رفيق الحفظ وابدأ بنقاط الضعف ثم الحفظ الجديد والمراجعة\\n${url}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:ورد حفظ القرآن', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'hifz-reminder.ics';
  a.click();
}

// ================= البدء =================
async function boot() {
  try {
    await loadQuran();
  } catch (e) {
    app.innerHTML = `<div class="card">تعذر تحميل نص القرآن. شغّل البرنامج من خادم ويب (انظر README).<br><span class="muted small">${esc(e.message)}</span></div>`;
    return;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  for (const el of document.querySelectorAll('[data-icon]')) el.outerHTML = icon(el.dataset.icon, { size: 22 });
  // فتح البرنامج على رابط شاشة معينة (#weak مثلاً)
  const initial = location.hash.slice(1);
  const start = TAB_VIEWS.includes(initial) ? initial : 'home';
  history.replaceState({ view: start }, '', `#${start}`);
  go(start, {}, { push: false });
  checkReminder();
  setInterval(checkReminder, 60 * 1000);
  // لو بقي البرنامج مفتوحاً لليوم التالي نحدث الرئيسية
  let day = dayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dayKey() !== day) {
      day = dayKey();
      if (!cleanup) go('home', {}, { push: false });
    }
  });
}

boot();

// للاختبار من الكونسول
window.__hifz = { getState, save, DEFAULT_SETTINGS, ayahText, surahRangeLabel };
