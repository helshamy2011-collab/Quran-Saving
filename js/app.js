import {
  loadQuran, surahName, ayahCount, toGlobal, fromGlobal, ayahWords, ayahText,
  describeAyahs, toArabicDigits, surahRangeLabel, describePosition, PAGES, pageAyahs, ayahPage, totalAyahs,
  similarOf, compareAyahs, confusionFor,
} from './quran.js';
import {
  getState, update, save, dayKey, formatDay, exportData, importData, resetAll, DEFAULT_SETTINGS,
  getProfiles, activeProfile, switchProfile, addProfile, renameProfile, deleteProfile, peekProfile,
} from './store.js';
import { todayPlan, recordSession, recordPractice, isReadIssue, stats, projection, previewChunk, dueWeak, weakAyahs, memorizedSet, UNIT_LABEL, WEAK_INTERVALS } from './plan.js';
import { STATUS, isMistake } from './matcher.js';
import { speechSupported } from './speech.js';
import { Recitation, STATUS_LABEL, wordsOf } from './recitation.js';
import { icon } from './icons.js';
import { renderGuided } from './guided.js';
import { renderQuiz } from './quiz.js';
import { renderPlacement } from './placement.js';
import { renderPages, autoFit, getView, setView, tafsirOf, gharibOf } from './mushaf.js';
import { voiceFix } from './voicefix.js';
import { Player, wordUrl, ayahUrl } from './audio.js';

// رقم الإصدار — لازم يساوي رقم ذاكرة العمل بدون إنترنت في sw.js (يتأكد منه الاختبار)
export const APP_VERSION = 17;
let reloadPending = false; // وصل تحديث أثناء التسميع: نعيد التحميل عند الرجوع لأي تبويب

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
const TAB_VIEWS = ['home', 'mushaf', 'weak', 'free', 'plan', 'people', 'similar'];

function go(view, params = {}, { push = true } = {}) {
  if (reloadPending && TAB_VIEWS.includes(view)) { location.hash = view; location.reload(); return; }
  if (cleanup) { cleanup(); cleanup = null; }
  app.onsubmit = null;
  const tab = TAB_VIEWS.includes(view) ? view : null;
  for (const b of tabs.querySelectorAll('button')) {
    if (b.dataset.view === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  // شاشتا الحفظ والتسميع تملآن الشاشة ويحل شريط التحكم محل شريط التنقل
  document.body.classList.toggle('immersive', !tab);
  document.body.dataset.view = view;
  if (push && location.hash !== `#${view}`) history.pushState({ view }, '', `#${view}`);
  window.scrollTo(0, 0);
  const views = { home: renderHome, weak: renderWeak, free: renderFree, plan: renderPlan, study: renderStudy, recite: renderRecite, guided: renderGuidedView, people: renderPeople, similar: renderSimilar, mushaf: renderMushaf, quiz: renderQuizView, placement: renderPlacementView };
  views[view](params);
  refreshBadge();
  refreshProfileButton();
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

function refreshProfileButton() {
  const p = activeProfile();
  const many = getProfiles().list.length > 1;
  const btn = document.getElementById('profile-btn');
  btn.setAttribute('aria-current', document.body.dataset.view === 'people' ? 'page' : 'false');
  document.getElementById('profile-avatar').textContent = p.name.trim().charAt(0) || '؟';
  document.getElementById('profile-avatar').style.background = p.color;
  document.getElementById('profile-name').textContent = many ? p.name : 'الأشخاص';
  btn.setAttribute('aria-label', `${p.name} — تبديل الشخص أو إضافة شخص`);
}

document.getElementById('profile-btn').addEventListener('click', () => go('people'));

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
      range = `<p class="range">${esc(describeAyahs(t.ayahs))} <span class="muted small">· ${ar(t.ayahs.length)} آية</span></p>
        ${t.id === 'weak' ? '' : `<p class="position small">${icon('book', { size: 14 })}${describePosition(t.ayahs)}</p>`}`;
      if (t.id === 'new' && !t.done) {
        actions = `<button type="button" class="btn primary" data-act="guided">${icon('sprout')}حفّظني خطوة بخطوة</button>
                   <button type="button" class="btn" data-act="study">${icon('headphones')}استمع</button>
                   <button type="button" class="btn" data-act="recite" data-task="new">${icon('mic')}سمّع</button>
                   <button type="button" class="btn ghost" data-act="know" data-g="${t.ayahs[0]}">حافظه؟ سمّعه وأنا أعدّي</button>`;
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
  // المطلوب الآن أولاً، ثم ما تم، ثم البطاقات الفارغة
  const rank = (t) => (!t.ayahs.length ? 2 : t.done ? 1 : 0);
  const ordered = plan.tasks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  // الملخص يظهر بعد أول تقدم (أصفار كثيرة في البداية لا تفيد)
  const known = memorizedSet();
  const started = s.ayahs > 0 || s.streak > 0 || s.weakActive > 0 || getState().sessions.length > 0;

  app.innerHTML = `
    <header class="page-head">
      <h1>${formatDay(plan.today)}</h1>
      <p class="muted">${pending ? `باقي لك ${ar(pending)} ${pending === 1 ? 'مهمة' : 'مهام'} اليوم` : 'أتممت ورد اليوم، بارك الله فيك'}</p>
    </header>
    ${weakTask.count ? `<div class="alert" role="note">${icon('bell')}<div><b>تذكير:</b> عندك <b>${ar(weakTask.count)}</b> كلمة أخطأت فيها أو نسيتها من قبل وحان وقت مراجعتها. ابدأ بها قبل أي شيء.</div></div>` : ''}
    ${started ? `<section class="card summary" aria-label="ملخص التقدم">
      <div class="stats-row">
        <div class="stat"><b>${ar(s.ayahs)}</b><span>آية محفوظة</span></div>
        <div class="stat"><b>${ar(s.pages.toFixed(1))}</b><span>صفحة</span></div>
        <div class="stat"><b>${icon('flame', { size: 16, cls: 'flame' })}${ar(s.streak)}</b><span>يوم متتالٍ</span></div>
        <div class="stat"><b>${ar(s.weakActive)}</b><span>نقطة ضعف</span></div>
      </div>
      <div class="row small"><span>التقدم في حفظ القرآن</span><span class="spacer"></span><b>${ar(s.percent.toFixed(1))}٪</b></div>
      <div class="progress" role="progressbar" aria-label="التقدم في حفظ القرآن" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.percent.toFixed(1)}"><i style="width:${Math.min(100, s.percent)}%"></i></div>
    </section>` : ''}
    ${ordered.map(taskCard).join('')}
    ${known.size >= 3 ? `<section class="card task quiz-card" aria-label="اختبر حفظك">
      <div class="task-icon quiz">${icon('target', { size: 22 })}</div>
      <div class="body">
        <h2 class="task-title">اختبر حفظك</h2>
        <p class="muted small">أسئلة سريعة من كل محفوظك (${ar(known.size)} آية)</p>
        <div class="row actions">
          <button type="button" class="btn" data-act="quiz" data-mode="continue">${icon('mic')}كمّل الآية</button>
          <button type="button" class="btn" data-act="quiz" data-mode="link">${icon('book')}ربط الصفحات</button>
        </div>
      </div>
    </section>` : ''}
    ${recentSessions()}
  `;

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'study') go('study');
    if (b.dataset.act === 'guided') go('guided');
    if (b.dataset.act === 'know') go('placement', { s: fromGlobal(Number(b.dataset.g)).s, returnTo: 'home' });
    if (b.dataset.act === 'quiz') go('quiz', { pool: [...known], mode: b.dataset.mode, label: 'محفوظك', returnTo: 'home' });
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

// زر التبديل بين صفحات المصحف والنص المتصل
function viewToggle() {
  const pages = getView() === 'pages';
  return `<button type="button" class="view-toggle" data-act="view" aria-pressed="${pages}" title="طريقة العرض">
    ${icon(pages ? 'book' : 'text', { size: 18 })}<span>${pages ? 'صفحة المصحف' : 'نص متصل'}</span></button>`;
}

function toggleView() {
  setView(getView() === 'pages' ? 'flow' : 'pages');
  return getView();
}

function renderStudy() {
  const plan = todayPlan();
  const t = plan.tasks.find((x) => x.id === 'new');
  const weak = getState().weak;
  const reciter = getState().settings.reciter;
  const studyWord = (w, g, i) => {
    const wk = weak[`${g}:${i}`];
    return `<span class="w ${wk && !wk.mastered ? 'weak' : ''}" data-g="${g}" data-k="${i}">${w.text}</span>`;
  };
  const mushafHtml = () => {
    if (getView() === 'pages') return renderPages(t.ayahs, { word: (idx, w, g, k) => studyWord(w, g, k) });
    let html = '';
    let lastS = 0;
    for (const g of t.ayahs) {
      const { s, a } = fromGlobal(g);
      if (s !== lastS) { html += `<span class="surah-head">سورة ${surahName(s)}</span>`; lastS = s; }
      html += ayahWords(g).map((w, i) => studyWord(w, g, i)).join(' ');
      html += ` <button type="button" class="ayah-end" data-ayah="${g}" aria-label="الآية ${ar(a)} — التفسير">﴿${ar(a)}﴾</button><button type="button" class="ayah-play" data-g="${g}" aria-label="استمع للآية ${ar(a)}">${icon('play', { size: 14 })}</button> `;
      const sims = similarOf(g).filter((x) => !(x.score === 100 && fromGlobal(x.g).s === s));
      if (sims.length) html += `<button type="button" class="sim-chip" data-sim="${g}">${icon('layers', { size: 14 })}متشابهة مع ${refOf(sims[0].g)}${sims.length > 1 ? ` و${ar(sims.length - 1)} غيرها` : ''}</button> `;
    }
    return html;
  };

  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>الحفظ الجديد</h1><p class="muted small">${esc(describeAyahs(t.ayahs))} · ${describePosition(t.ayahs)}</p></div>
      ${viewToggle()}
    </div>
    <div class="player card">
      <button type="button" class="btn" data-act="play-all" id="play-all">${icon('play', { size: 16 })}<span>استمع للورد كله</span></button>
      <label class="inline-field">تكرار
        <select id="repeat" aria-label="تكرار كل آية">${[1, 3, 5, 10].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${ar(n)} ${n > 2 && n < 11 ? 'مرات' : 'مرة'}</option>`).join('')}</select>
      </label>
      <p class="muted small">${icon('headphones', { size: 14 })}${RECITERS[reciter] || reciter} · اضغط على كلمة لمعناها، وعلى رقم الآية ﴿ ﴾ لتفسيرها</p>
    </div>
    <div class="mushaf study" id="mushaf"></div>
    <details class="card tip">
      <summary>${icon('info', { size: 18 })}طريقة الحفظ المقترحة</summary>
      <ol>
        <li>استمع للآية ٣ مرات وأنت تنظر للمصحف.</li>
        <li>اقرأها ٥ مرات، ثم اقرأها مغمض العينين.</li>
        <li>بعد ما تثبت كل الآيات اربطها ببعض.</li>
        <li>اضغط «سمّع» — لازم تحقق ${ar(getState().settings.passMark)}٪ لاعتماد الحفظ.</li>
      </ol>
    </details>
    <div class="dock"><div class="inner">
      <p class="heard">لما تحس إنك حفظت، ابدأ التسميع والنص هيكون مخفي.</p>
      <button type="button" class="btn big" data-act="guided">${icon('sprout')}حفّظني</button>
      <button type="button" class="btn primary big" data-act="recite">${icon('mic')}جاهز — سمّع</button>
    </div></div>
  `;

  const mushafEl = document.getElementById('mushaf');
  let unfit = null;
  const paintMushaf = () => {
    unfit?.();
    unfit = null;
    mushafEl.innerHTML = mushafHtml();
    mushafEl.classList.toggle('paged', getView() === 'pages');
    if (getView() === 'pages') unfit = autoFit(mushafEl);
  };
  paintMushaf();

  const playAllBtn = document.getElementById('play-all');
  const setPlayAll = (playing) => {
    playAllBtn.dataset.act = playing ? 'stop' : 'play-all';
    playAllBtn.innerHTML = playing ? `${icon('stop', { size: 16 })}<span>إيقاف</span>` : `${icon('play', { size: 16 })}<span>استمع للورد كله</span>`;
  };
  const stopAudio = () => {
    if (audio) { audio.pause(); audio = null; }
    app.querySelectorAll('.ayah-play.playing').forEach((b) => { b.classList.remove('playing'); b.innerHTML = icon('play', { size: 14 }); });
    app.querySelectorAll('.w.playing').forEach((w) => w.classList.remove('playing'));
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
      app.querySelectorAll('.w.playing').forEach((w) => w.classList.remove('playing'));
      if (g == null) { audio = null; setPlayAll(false); return; }
      setPlayAll(true);
      const { s, a } = fromGlobal(g);
      const btn = app.querySelector(`.ayah-play[data-g="${g}"]`);
      if (btn) { btn.classList.add('playing'); btn.innerHTML = icon('pause', { size: 14 }); }
      const ws = app.querySelectorAll(`.w[data-g="${g}"]`);
      ws.forEach((w) => w.classList.add('playing'));
      ws[0]?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
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
    const sim = e.target.closest('.sim-chip');
    if (sim) return openCompare(Number(sim.dataset.sim));
    const mark = e.target.closest('[data-ayah]');
    if (mark) return openAyah(Number(mark.dataset.ayah), { onPlay: (g) => playQueue([g]) });
    const word = e.target.closest('#mushaf .w[data-k]');
    if (word) {
      const g = Number(word.dataset.g);
      return openWord(g, Number(word.dataset.k), { mark: marker(mushafEl, g), onAyah: (x) => openAyah(x, { onPlay: (y) => playQueue([y]) }) });
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') back();
    if (act === 'view') { toggleView(); b.outerHTML = viewToggle(); stopAudio(); paintMushaf(); }
    if (act === 'play-all') playQueue(t.ayahs);
    if (act === 'stop') stopAudio();
    if (act === 'recite') go('recite', { taskId: 'new', label: 'الحفظ الجديد', ayahs: t.ayahs });
    if (act === 'guided') go('guided');
  };
  cleanup = () => { stopAudio(); unfit?.(); };
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

// ================= كمّل الآية / ربط الصفحات =================
function renderQuizView(params = {}) {
  if (!params.pool?.length) { go('home', {}, { push: false }); return; }
  renderQuiz({ app, toast, go, back: (to) => back(to), setCleanup: (fn) => { cleanup = fn; } }, params);
}

// ================= سمّع اللي حافظه (وابدأ الحفظ من مكان ما تقف) =================
function renderPlacementView(params = {}) {
  if (!params.s) { go('home', {}, { push: false }); return; }
  renderPlacement({ app, toast, go, back: (to) => back(to), setCleanup: (fn) => { cleanup = fn; } }, params);
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
      ${viewToggle()}
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
      <li><i class="sw unsure"></i>ما اتسمعتش بوضوح</li>
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
    // التفسير أثناء التسميع: نوقف الميكروفون ولا نعرض نص الآية المخفي
    onAyah: (g) => {
      rec.pause();
      openAyah(g, { hideText: !reading && !finished, onClose: () => { if (!finished) rec.resume(); } });
    },
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
    onMistake: (list) => fixer.onMistake(list),
  });
  const fixer = voiceFix(rec, { enabled: () => getState().settings.voiceFix, reciter: () => getState().settings.reciter });
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
    // هل الخطأ خلط بآية متشابهة؟
    const confused = status.map((x, i) => (isMistake(x) && !reading ? confusionFor(words[i].g, words[i].w, rec.matcher.heardAt[i], x) : null));
    recordSession({ taskId, label, words, status, score: sc, reading, confused });
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
    const unsure = status.map((x, i) => ({ x, i })).filter((o) => o.x === STATUS.UNSURE);
    const unsureHtml = unsure.length ? `<div class="unsure-box">
      <p>${icon('info', { size: 16 })}<b>مش متأكد إنك قلتها:</b> ${unsure.map(({ i }) => `<span class="w unsure">${words[i].text}</span>`).join('، ')}</p>
      <p class="muted small">البرنامج ما سمعهاش بوضوح (كلمة قصيرة، أو جت وقت ما الميكروفون كان بيعيد التشغيل بعد وقفة). مش محسوبة غلط — بس اتأكد إنك قلتها.</p>
    </div>` : '';
    const logHtml = rec.log.length ? `<details class="heard-log">
      <summary>${icon('mic', { size: 16 })}اللي سمعه البرنامج</summary>
      <ol>${rec.log.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <p class="muted small">لو البرنامج حسب عليك كلمة غلط وانت قلتها صح، انسخ ده وابعته عشان يتظبط.</p>
      <button type="button" class="btn small-btn" data-act="copy-log">نسخ</button>
    </details>` : '';
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
      <ul class="mistake-list">${mistakes.map(({ x, i }) => mistakeItem(words[i], x, readIssue[i] && !reading, confused[i])).join('')}</ul>
      <p class="muted small">${reading
        ? 'دي غالباً مشكلة نطق أو البرنامج مش بيفهمها. اسمعها من القارئ وصحّح نطقها، ووقت التسميع لو "غلط" فيها مش هتتحسب خطأ حفظ.'
        : 'ستظهر لك في «نقاط الضعف» غداً، ثم بعد يومين، ثم ٤، ثم أسبوع… حتى تثبت تماماً.'}</p>`
      : `<p class="verdict ok">${icon('award')}<span>لا أخطاء، ما شاء الله!</span></p>`}
      ${unsureHtml}
      ${logHtml}
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
      const cmp = e.target.closest('[data-cmp]');
      if (cmp) { const [x, y] = cmp.dataset.cmp.split(',').map(Number); openCompare(x, y); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'copy-log') {
        const ref = describeAyahs(ayahs);
        const text = `${ref}\n${rec.log.join('\n')}`;
        navigator.clipboard?.writeText(text).then(() => toast('اتنسخ — ابعته في الشات')).catch(() => toast('ما قدرتش أنسخ — صوّر الشاشة'));
        return;
      }
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
    if (!b || b.closest('#result')) return;
    if (b.dataset.act === 'back') back(returnTo);
    if (b.dataset.act === 'view') { rec.setLayout(toggleView()); b.outerHTML = viewToggle(); }
  };
  cleanup = () => { finished = true; fixer.stop(); rec.destroy(); };
}

// سطر في قائمة الأخطاء: الكلمة في سياقها
function mistakeItem(w, x, readIssue = false, confusedWith = null) {
  const { s, a } = fromGlobal(w.g);
  const all = ayahWords(w.g);
  const from = Math.max(0, w.w - 2);
  const ctx = all.slice(from, w.w + 3).map((y, k) => (from + k === w.w ? `<mark>${y.text}</mark>` : y.text)).join(' ');
  return `<li><span class="tag ${x}">${STATUS_LABEL[x]}</span><span class="q">${ctx}</span><span class="muted small">${surahName(s)} ${ar(a)}</span>
    ${readIssue ? '<span class="tag soft" title="البرنامج بيغلط فيها حتى وانت بتقرأ بالنظر">صعبة في القراءة كمان — مش محسوبة خطأ حفظ</span>' : ''}
    ${confusedWith != null ? `<span class="confusion">${icon('layers', { size: 14 })}خلطت مع ${refOf(confusedWith)}
      <button type="button" class="btn small-btn" data-cmp="${w.g},${confusedWith}">قارن</button></span>` : ''}</li>`;
}

// ================= المتشابهات =================
const refOf = (g) => { const { s, a } = fromGlobal(g); return `${surahName(s)} ${ar(a)}`; };

// نص الآية مع تمييز الكلمات التي تنفرد بها عن متشابهتها
function diffText(g, only) {
  const set = new Set(only);
  return ayahWords(g).map((w, i) => (set.has(i) ? `<mark class="diff">${w.text}</mark>` : w.text)).join(' ');
}

function prevContext(g) {
  if (g === 0) return '';
  const { s } = fromGlobal(g);
  if (fromGlobal(g - 1).s !== s) return '<p class="ctx muted small">أول السورة</p>';
  const words = ayahWords(g - 1);
  return `<p class="ctx muted small">قبلها: … ${words.slice(-4).map((w) => w.text).join(' ')}</p>`;
}

function compareBlock(g, h) {
  const { onlyA, onlyB, identical } = compareAyahs(g, h);
  return `<div class="compare-pair">
    <div class="cmp"><h3>${refOf(g)}</h3>${prevContext(g)}<p class="q">${diffText(g, onlyA)}</p></div>
    <div class="cmp"><h3>${refOf(h)}</h3>${prevContext(h)}<p class="q">${diffText(h, onlyB)}</p></div>
    ${identical ? '<p class="muted small">الآيتان متطابقتان في اللفظ — الفرق في موضعهما: ركّز على الآية اللي قبل كل واحدة.</p>' : ''}
  </div>`;
}

// نافذة منبثقة من أسفل الشاشة؛ onClick(e, close) لأزرارها
function openSheet({ title, iconName, body, onClick, onClose }) {
  const prevFocus = document.activeElement;
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <div class="sheet-head"><h2 id="sheet-title">${icon(iconName)}${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('back', { size: 22, cls: 'flip' })}</button></div>
    ${body}
  </div>`;
  const close = () => {
    if (!sheet.isConnected) return;
    sheet.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) { close(); return; }
    onClick?.(e, close);
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(sheet);
  sheet.querySelector('[data-close]').focus();
  return { el: sheet.querySelector('.sheet'), close };
}

// نافذة المقارنة: الآية ومتشابهاتها، والكلمات المختلفة ملونة
function openCompare(g, onlyWith = null) {
  const list = onlyWith != null ? [onlyWith] : similarOf(g).slice(0, 3).map((x) => x.g);
  if (!list.length) return;
  openSheet({
    title: 'المتشابهات',
    iconName: 'layers',
    body: `<p class="muted small">الكلمات الملونة هي اللي بتفرق بين الآيتين.</p>
    ${list.map((h) => `${compareBlock(g, h)}
      <div class="row actions"><button type="button" class="btn primary" data-pair="${g},${h}">${icon('mic')}سمّعهم ورا بعض</button></div>`).join('<hr>')}`,
    onClick: (e, close) => {
      const pair = e.target.closest('[data-pair]');
      if (!pair) return;
      close();
      const ayahs = pair.dataset.pair.split(',').map(Number).sort((x, y) => x - y);
      go('recite', { taskId: 'similar', label: 'متشابهات', ayahs, returnTo: 'similar' });
    },
  });
}

// نافذة الآية: التفسير الميسر، والاستماع، والمتشابهات، والتنقل للآية السابقة والتالية
// hideText: أثناء التسميع لا نعرض نص الآية حتى لا نكشف المخفي
function openAyah(g, { onPlay = null, hideText = false, onClose } = {}) {
  const { el, close } = openSheet({
    title: '',
    iconName: 'book',
    body: '<div class="ayah-body"></div>',
    onClose,
    onClick: (e) => {
      if (e.target.closest('[data-play]')) { close(); onPlay(g); }
      if (e.target.closest('[data-sim]')) { close(); openCompare(g); }
      const nav = e.target.closest('[data-go]');
      if (nav) show(Number(nav.dataset.go));
    },
  });
  const titleEl = el.querySelector('#sheet-title');
  const body = el.querySelector('.ayah-body');
  // اقتباسات القرآن داخل التفسير ﴿…﴾ بخط المصحف
  // أثناء التسميع نخفي الاقتباسات حتى لا تنكشف الكلمات المخفية
  const tafsirHtml = (text) => text.split('\n')
    .map((x) => `<p>${esc(x).replace(/﴿[^﴾]*﴾/g, (q) => `<span class="qq">${hideText ? '﴿…﴾' : q}</span>`)}</p>`).join('');

  function show(target) {
    g = target;
    const { s, a } = fromGlobal(g);
    const sims = similarOf(g).filter((x) => !(x.score === 100 && fromGlobal(x.g).s === s));
    titleEl.innerHTML = `${icon('book')}${surahName(s)} <span class="muted">· الآية ${ar(a)}</span>`;
    const hasPrev = g > 0 && fromGlobal(g - 1).s === s;
    const hasNext = g + 1 < totalAyahs() && fromGlobal(g + 1).s === s;
    body.innerHTML = `${hideText ? '' : `<p class="q ayah-q">${ayahText(g)} <span class="ayah-end">﴿${ar(a)}﴾</span></p>`}
      ${onPlay || (sims.length && !hideText) ? `<div class="chip-row">
        ${onPlay ? `<button type="button" class="pill" data-play>${icon('play', { size: 16 })}استمع للآية</button>` : ''}
        ${sims.length && !hideText ? `<button type="button" class="pill" data-sim>${icon('layers', { size: 16 })}متشابهة مع ${refOf(sims[0].g)}</button>` : ''}
      </div>` : ''}
      <section class="tafsir" aria-live="polite"><h3>التفسير الميسر</h3><p class="muted">جارٍ التحميل…</p></section>
      <nav class="ayah-nav" aria-label="التنقل بين الآيات">
        <button type="button" class="btn" data-go="${g - 1}" ${hasPrev ? '' : 'disabled'}>${icon('chevronR', { size: 18 })}الآية ${ar(a - 1 || 1)}</button>
        <button type="button" class="btn" data-go="${g + 1}" ${hasNext ? '' : 'disabled'}>الآية ${ar(a + 1)}${icon('chevronL', { size: 18 })}</button>
      </nav>`;
    if (!hasPrev) body.querySelector('[data-go]').innerHTML = `${icon('chevronR', { size: 18 })}السابقة`;
    if (!hasNext) body.querySelectorAll('[data-go]')[1].innerHTML = `التالية${icon('chevronL', { size: 18 })}`;
    el.scrollTop = 0;
    const box = body.querySelector('.tafsir');
    tafsirOf(g).then((t) => {
      if (t?.s !== s || g !== target) return;
      const range = t.from === t.to ? '' : ` <span class="tag">الآيات ${ar(t.from)}–${ar(t.to)} معاً</span>`;
      box.innerHTML = `<h3>التفسير الميسر${range}</h3>${tafsirHtml(t.text)}
        <p class="muted small source">التفسير الميسر — مجمع الملك فهد لطباعة المصحف الشريف</p>`;
      gharibOf(target).then((list) => {
        if (hideText || !list.length || g !== target || !box.isConnected) return;
        box.insertAdjacentHTML('afterend', `<section class="tafsir meanings"><h3>معاني الكلمات</h3>
          ${list.map((x) => `<p><span class="qq">﴿${esc(x.phrase)}﴾</span> ${esc(x.meaning)}</p>`).join('')}</section>`);
      }).catch(() => {});
    }).catch(() => {
      if (g !== target) return;
      box.innerHTML = '<h3>التفسير الميسر</h3><p class="muted">تعذر تحميل التفسير — تأكد من الاتصال بالإنترنت وحاول مرة أخرى.</p>';
    });
  }
  show(g);
}

// نافذة الكلمة: معناها من «الميسر في غريب القرآن»، ومعاني باقي كلمات الآية
// mark(from, to): يميّز الكلمات في الصفحة (ويُلغى التمييز عند الإغلاق)
function openWord(g, k, { mark, onAyah } = {}) {
  const { s, a } = fromGlobal(g);
  const words = ayahWords(g);
  const player = new Player();
  const { el, close } = openSheet({
    title: `معنى الكلمة <span class="muted">· ${surahName(s)} ${ar(a)}</span>`,
    iconName: 'book',
    body: `<div class="word-body"><p class="muted">جارٍ التحميل…</p></div>`,
    onClose: () => { player.stop(); mark?.(null); },
    onClick: (e) => {
      if (e.target.closest('[data-say]')) player.play([{ urls: [wordUrl(g, k), ayahUrl(g, getState().settings.reciter)] }]);
      if (e.target.closest('[data-ayah-tafsir]')) { close(); onAyah?.(g); }
    },
  });
  const body = el.querySelector('.word-body');
  const meaningHtml = (x) => `<span class="qq">﴿${esc(x.phrase)}﴾</span> ${esc(x.meaning)}`;
  gharibOf(g).then((list) => {
    const hit = list.find((x) => k >= x.from && k <= x.to);
    mark?.(hit ? [hit.from, hit.to] : [k, k]);
    const others = list.filter((x) => x !== hit);
    body.innerHTML = `
      <p class="word-q">${hit ? esc(hit.phrase) : words[k].text}</p>
      ${hit ? `<p class="word-meaning">${esc(hit.meaning)}</p>`
        : '<p class="muted">الكلمة دي معناها واضح، ومش مشروحة في «الميسر في غريب القرآن». شوف تفسير الآية كاملة.</p>'}
      <div class="chip-row">
        <button type="button" class="pill" data-say>${icon('play', { size: 16 })}استمع للكلمة</button>
        ${onAyah ? `<button type="button" class="pill" data-ayah-tafsir>${icon('book', { size: 16 })}تفسير الآية</button>` : ''}
      </div>
      ${others.length ? `<section class="tafsir"><h3>معاني كلمات تانية في الآية</h3>${others.map((x) => `<p>${meaningHtml(x)}</p>`).join('')}</section>` : ''}
      <p class="muted small source">الميسر في غريب القرآن — مجمع الملك فهد لطباعة المصحف الشريف</p>`;
  }).catch(() => {
    body.innerHTML = '<p class="muted">تعذر تحميل معنى الكلمة — تأكد من الاتصال بالإنترنت وحاول مرة أخرى.</p>';
  });
}

// يميّز كلمات آية في الصفحة (لنافذة معنى الكلمة)
function marker(root, g) {
  return (range) => {
    root.querySelectorAll('.w.picked').forEach((w) => w.classList.remove('picked'));
    if (!range) return;
    for (let k = range[0]; k <= range[1]; k++) root.querySelector(`.w[data-g="${g}"][data-k="${k}"]`)?.classList.add('picked');
  };
}

// أزواج المتشابهات التي حفظ المستخدم الآيتين فيها
function memorizedPairs() {
  const known = memorizedSet();
  const weak = Object.values(getState().weak);
  const confusedCount = new Map();
  for (const w of weak) if (w.with != null) {
    const key = [w.g, w.with].sort((x, y) => x - y).join(',');
    confusedCount.set(key, (confusedCount.get(key) || 0) + w.misses);
  }
  const seen = new Set();
  const pairs = [];
  // الأزواج التي خلط بينها المستخدم فعلاً تظهر دائماً وأولاً
  for (const [key, n] of confusedCount) {
    const [a, b] = key.split(',').map(Number);
    const score = similarOf(a).find((x) => x.g === b)?.score ?? 0;
    seen.add(key);
    pairs.push({ a, b, score, confused: n });
  }
  for (const g of known) {
    for (const { g: h, score } of similarOf(g)) {
      if (!known.has(h)) continue;
      const key = [g, h].sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      // الآيات المكررة بنفس اللفظ في نفس السورة (فبأي آلاء ربكما تكذبان) لا تحتاج تفريقاً لفظياً
      if (score === 100 && fromGlobal(g).s === fromGlobal(h).s) continue;
      const [a, b] = key.split(',').map(Number);
      pairs.push({ a, b, score, confused: confusedCount.get(key) || 0 });
    }
  }
  return pairs.sort((x, y) => y.confused - x.confused || y.score - x.score || x.a - y.a);
}

function renderSimilar() {
  const pairs = memorizedPairs();
  const card = (p) => {
    const { onlyA, onlyB } = compareAyahs(p.a, p.b);
    const da = onlyA.map((i) => ayahWords(p.a)[i].text).slice(0, 4).join(' ');
    const db = onlyB.map((i) => ayahWords(p.b)[i].text).slice(0, 4).join(' ');
    return `<li class="card sim-pair ${p.confused ? 'is-due' : ''}">
      <div class="weak-meta"><h2>${refOf(p.a)} <span class="muted">و</span> ${refOf(p.b)}</h2>
        <span class="tag soft">تشابه ${ar(p.score)}٪</span>
        ${p.confused ? `<span class="tag wrong">خلطت بينهم ${ar(p.confused)} ${p.confused === 1 ? 'مرة' : 'مرات'}</span>` : ''}</div>
      ${da || db ? `<p class="sim-diff"><span class="q"><mark class="diff">${da}</mark></span> <span class="muted">↔</span> <span class="q"><mark class="diff">${db}</mark></span></p>` : ''}
      <div class="row actions">
        <button type="button" class="btn" data-cmp="${p.a},${p.b}">${icon('layers', { size: 18 })}قارن</button>
        <button type="button" class="btn ${p.confused ? 'primary' : ''}" data-pair="${p.a},${p.b}">${icon('mic', { size: 18 })}سمّعهم ورا بعض</button>
      </div>
    </li>`;
  };
  app.innerHTML = `
    <div class="sub-head">
      <button type="button" class="icon-btn" data-act="back" aria-label="رجوع">${icon('back', { size: 22 })}</button>
      <div class="sub-title"><h1>المتشابهات في محفوظك</h1><p class="muted small">آيات متشابهة في اللفظ حفظت الاتنين منهم</p></div>
    </div>
    <p class="muted">لما تسمّع وتغلط بلفظ الآية المتشابهة، البرنامج بيقولك «خلطت مع آية كذا» وبيسجلها هنا فوق. سمّع الآيتين ورا بعض عشان تثبّت الفرق.</p>
    ${pairs.length ? `<ul class="people">${pairs.map(card).join('')}</ul>`
      : `<div class="card empty-state">${icon('layers', { size: 40 })}<h2>لسه مفيش متشابهات في محفوظك</h2>
        <p class="muted">هتظهر هنا أول ما تحفظ آيتين متشابهتين. وفي شاشة الحفظ هتلاقي علامة «متشابهة» تحت أي آية ليها شبيه في القرآن.</p></div>`}
  `;
  app.onclick = (e) => {
    const b = e.target.closest('[data-act], [data-cmp], [data-pair]');
    if (!b) return;
    if (b.dataset.act === 'back') back('weak');
    if (b.dataset.cmp) { const [a, c] = b.dataset.cmp.split(',').map(Number); openCompare(a, c); }
    if (b.dataset.pair) go('recite', { taskId: 'similar', label: 'متشابهات', ayahs: b.dataset.pair.split(',').map(Number), returnTo: 'similar' });
  };
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
      ${(() => { const w = list.find((x) => x.with != null); return w ? `<p class="confusion">${icon('layers', { size: 14 })}خلطت مع ${refOf(w.with)}
        <button type="button" class="btn small-btn" data-cmp="${g},${w.with}">قارن</button></p>` : ''; })()}
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
    ${(() => { const n = memorizedPairs().length; return n ? `<button type="button" class="card link-card" data-act="similar">${icon('layers')}<span><b>المتشابهات في محفوظك</b><span class="muted small">${ar(n)} ${n === 1 ? 'زوج' : 'أزواج'} من الآيات المتشابهة — فرّق بينهم</span></span></button>` : ''; })()}
    ${groups.length ? `<div class="row actions page-actions">
      ${due.length ? `<button type="button" class="btn primary" data-act="due">${icon('target')}سمّع المستحق الآن · ${ar(weakAyahs(due).length)} آية</button>` : ''}
      <button type="button" class="btn" data-act="all">${icon('layers')}سمّع كل نقاط الضعف</button>
    </div>
    ${groups.map(ayahCard).join('')}` : `<div class="card empty-state">${icon('award', { size: 40 })}<h2>لا توجد نقاط ضعف</h2>
      <p class="muted">ابدأ التسميع وسيتابع البرنامج أخطاءك تلقائياً.</p>
      <button type="button" class="btn primary" data-act="home">${icon('today')}ورد اليوم</button></div>`}
  `;

  app.onclick = (e) => {
    const cmp = e.target.closest('[data-cmp]');
    if (cmp) { const [x, y] = cmp.dataset.cmp.split(',').map(Number); openCompare(x, y); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'due') go('recite', { taskId: 'weak', label: 'نقاط الضعف', ayahs: weakAyahs(due), returnTo: 'weak' });
    if (act === 'all') go('recite', { taskId: 'weak-all', label: 'كل نقاط الضعف', ayahs: [...byAyah.keys()].sort((x, y) => x - y).slice(0, 30), returnTo: 'weak' });
    if (act === 'one') go('recite', { taskId: 'weak-one', label: 'نقطة ضعف', ayahs: [Number(b.dataset.g)], returnTo: 'weak' });
    if (act === 'home') go('home');
    if (act === 'similar') go('similar');
    if (act === 'del') {
      if (!confirm('إزالة هذه الآية من نقاط الضعف؟ لن تظهر لك للمراجعة بعد ذلك.')) return;
      const g = Number(b.dataset.g);
      update((s) => { for (const k of Object.keys(s.weak)) if (s.weak[k].g === g) delete s.weak[k]; });
      go('weak');
    }
  };
}

// ================= المصحف (قراءة وتفسير) =================
function renderMushaf({ page } = {}) {
  let p = page || Number(localStorage.getItem('mushaf-page')) || 1;
  const reciter = getState().settings.reciter;
  app.innerHTML = `
    <header class="page-head compact">
      <h1>المصحف</h1>
      <p class="muted small">اضغط على كلمة لمعناها، وعلى رقم الآية ﴿ ﴾ لتفسيرها · اسحب الصفحة للتقليب</p>
    </header>
    <div class="reader-bar card">
      <button type="button" class="icon-btn" data-act="prev" aria-label="الصفحة السابقة">${icon('chevronR', { size: 22 })}</button>
      <select id="ps" aria-label="انتقل إلى سورة">${Array.from({ length: 114 }, (_, i) => `<option value="${i + 1}">سورة ${surahName(i + 1)}</option>`).join('')}</select>
      <label class="page-field"><span>ص</span><input type="text" id="pg" inputmode="numeric" autocomplete="off" aria-label="رقم الصفحة من ${ar(PAGES)}"></label>
      <button type="button" class="icon-btn" data-act="next" aria-label="الصفحة التالية">${icon('chevronL', { size: 22 })}</button>
    </div>
    <div class="mushaf paged reader" id="mushaf"></div>
    <div class="row actions reader-actions">
      <button type="button" class="btn primary" data-act="recite">${icon('mic')}سمّع الصفحة دي</button>
      <button type="button" class="btn" data-act="read">${icon('book')}اقرأها بالنظر</button>
    </div>`;
  const el = document.getElementById('mushaf');
  const pg = document.getElementById('pg');
  const ps = document.getElementById('ps');
  let unfit = null;
  let player = null;
  const stop = () => {
    if (player) { player.pause(); player = null; }
    el.querySelectorAll('.w.playing').forEach((w) => w.classList.remove('playing'));
  };
  const show = (n) => {
    n = Math.min(PAGES, Math.max(1, n));
    // ترك حقل الرقم يطلق change مرة أخرى؛ إعادة الرسم وقتها تضيّع الضغطة على رقم الآية
    if (n === p && el.childElementCount) { pg.value = ar(p); return; }
    stop();
    p = n;
    localStorage.setItem('mushaf-page', String(p));
    const list = pageAyahs(p);
    el.innerHTML = renderPages(list, { word: (i, w, g, k) => `<span class="w" data-g="${g}" data-k="${k}">${w.text}</span>` });
    unfit?.();
    unfit = autoFit(el);
    pg.value = ar(p);
    ps.value = String(fromGlobal(list[0]).s);
  };
  const play = (g) => {
    stop();
    const { s, a } = fromGlobal(g);
    const audioEl = new Audio(`https://everyayah.com/data/${reciter}/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`);
    player = audioEl;
    el.querySelectorAll(`.w[data-g="${g}"]`).forEach((w) => w.classList.add('playing'));
    audioEl.onended = () => { if (player === audioEl) stop(); };
    audioEl.onerror = () => { toast('تعذر تشغيل الصوت — تأكد من الاتصال بالإنترنت'); stop(); };
    audioEl.play().catch(() => {});
  };
  show(p);
  // يقبل الأرقام العربية والإنجليزية
  pg.onchange = () => show(Number(pg.value.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '')) || p);
  pg.onfocus = () => pg.select();
  ps.onchange = () => show(ayahPage(toGlobal(Number(ps.value), 1)));
  app.onclick = (e) => {
    const mark = e.target.closest('[data-ayah]');
    if (mark) return openAyah(Number(mark.dataset.ayah), { onPlay: play });
    const word = e.target.closest('#mushaf .w[data-k]');
    if (word) {
      const g = Number(word.dataset.g);
      return openWord(g, Number(word.dataset.k), { mark: marker(el, g), onAyah: (x) => openAyah(x, { onPlay: play }) });
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'next') show(p + 1);
    if (act === 'prev') show(p - 1);
    if (act === 'recite' || act === 'read') {
      const reading = act === 'read';
      go('recite', { taskId: 'free', label: reading ? `قراءة صفحة ${ar(p)}` : `تسميع صفحة ${ar(p)}`, ayahs: pageAyahs(p), returnTo: 'mushaf', reading });
    }
  };
  // السحب يميناً = الصفحة التالية (كتقليب المصحف)
  let sx = null;
  let sy = null;
  el.ontouchstart = (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
  el.ontouchend = (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      show(dx > 0 ? p + 1 : p - 1);
      el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    }
  };
  cleanup = () => { stop(); unfit?.(); };
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
    </form>
    <section class="card quiz-free">
      <h2>${icon('target', { size: 20 })}اختبر نفسك في المقطع ده</h2>
      <p class="muted small"><b>كمّل الآية:</b> تسمع أول كلمات آية وتكمّلها. <b>ربط الصفحات:</b> تسمع آخر آية في صفحة وتقول أول آية في اللي بعدها.</p>
      <div class="row actions">
        <button type="button" class="btn" data-quiz="continue">${icon('mic')}كمّل الآية</button>
        <button type="button" class="btn" data-quiz="link">${icon('book')}ربط الصفحات</button>
      </div>
    </section>`;
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
  // المقطع المختار: السورة والآيات
  const range = () => {
    const s = Number(fs.value);
    let from = Math.max(1, Number(ff.value) || 1);
    let to = Math.min(ayahCount(s), Number(ft.value) || from);
    if (to < from) [from, to] = [to, from];
    const ayahs = [];
    for (let a = from; a <= to; a++) ayahs.push(toGlobal(s, a));
    return { s, from, to, ayahs };
  };
  document.getElementById('free-form').onsubmit = (e) => {
    e.preventDefault();
    const { s, from, to, ayahs } = range();
    const mode = form.mode.value;
    localStorage.setItem('free-last', JSON.stringify({ s, from, to, mode }));
    if (mode === 'guided') go('guided', { ayahs, label: `حفّظني — ${surahName(s)}`, returnTo: 'free' });
    else go('recite', { taskId: 'free', label: mode === 'reading' ? 'قراءة بالنظر' : 'تسميع حر', ayahs, returnTo: 'free', reading: mode === 'reading' });
  };
  app.onclick = (e) => {
    const q = e.target.closest('[data-quiz]');
    if (!q) return;
    const { s, ayahs } = range();
    go('quiz', { pool: ayahs, mode: q.dataset.quiz, label: surahName(s), returnTo: 'free' });
  };
}

// ================= الأشخاص وملف الحفظ =================
function renderPeople() {
  const { list, active } = getProfiles();
  const today = dayKey();
  const card = (p) => {
    const d = peekProfile(p.id);
    const known = new Set(d.memorized);
    for (const s of d.settings.prior) for (let a = 1; a <= ayahCount(s); a++) known.add(toGlobal(s, a));
    const due = Object.values(d.weak).filter((w) => !w.mastered && w.due <= today).length;
    const isActive = p.id === active;
    return `<li class="card person ${isActive ? 'is-active' : ''}">
      <span class="avatar big" style="background:${p.color}" aria-hidden="true">${esc(p.name.trim().charAt(0) || '؟')}</span>
      <div class="person-body">
        <h2>${esc(p.name)} ${isActive ? '<span class="tag ok">الحالي</span>' : ''}</h2>
        <p class="muted small">${d.setupDone ? `${ar(known.size)} آية محفوظة${due ? ` · ${ar(due)} كلمة للمراجعة اليوم` : ''}` : 'لم يبدأ خطته بعد'}</p>
        <div class="row actions">
          ${isActive ? `<button type="button" class="btn primary" data-act="open" data-id="${p.id}">${icon('today')}ورد اليوم</button>`
            : `<button type="button" class="btn primary" data-act="switch" data-id="${p.id}">${icon('check')}اختيار</button>`}
          <button type="button" class="btn ghost" data-act="rename" data-id="${p.id}">تغيير الاسم</button>
          ${list.length > 1 ? `<button type="button" class="btn ghost danger" data-act="delete" data-id="${p.id}">${icon('trash', { size: 18 })}حذف</button>` : ''}
        </div>
        <div class="inline-panel" id="panel-${p.id}" hidden></div>
      </div>
    </li>`;
  };

  app.innerHTML = `
    <header class="page-head">
      <h1>الأشخاص</h1>
      <p class="muted">كل شخص له خطته وتقدمه ونقاط ضعفه لوحده على نفس الموبايل.</p>
    </header>
    <ul class="people">${list.map(card).join('')}</ul>
    <form class="card form add-person" id="add-form">
      <label class="field"><span>إضافة شخص جديد</span>
        <div class="combo wide"><input type="text" id="new-name" maxlength="30" placeholder="الاسم" autocomplete="off" required>
        <button type="submit" class="btn primary">${icon('sprout')}إضافة</button></div></label>
      <p class="error small" id="name-error" hidden>${icon('alert', { size: 16 })}اكتب الاسم الأول.</p>
    </form>
    <section class="card">
      <h2>${icon('download', { size: 20 })} ملف الحفظ</h2>
      <p class="muted small">البيانات محفوظة على الموبايل ده بس. احفظ ملف فيه كل الأشخاص عشان لو غيّرت الموبايل أو مسحت المتصفح،
        أو عشان تنقلهم لموبايل تاني. ابعته لنفسك على واتساب أو احفظه في Drive.</p>
      <div class="row actions">
        <button type="button" class="btn primary" data-act="export">${icon('download')}حفظ ملف</button>
        <label class="btn file-btn">${icon('upload')}فتح ملف حفظ<input type="file" id="imp" accept="application/json,.json"></label>
      </div>
      <p class="muted small">عند فتح ملف: الأشخاص بنفس الاسم تتحدث بياناتهم، والأسماء الجديدة تتضاف.</p>
    </section>
  `;

  const panel = (id, html) => {
    app.querySelectorAll('.inline-panel').forEach((x) => { x.hidden = true; x.innerHTML = ''; });
    const el = document.getElementById(`panel-${id}`);
    el.innerHTML = html;
    el.hidden = false;
    el.querySelector('input, .btn')?.focus();
  };

  app.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act, id } = b.dataset;
    if (act === 'open') go('home');
    if (act === 'switch') { switchProfile(id); toast(`أهلاً ${activeProfile().name}`); go('home'); }
    if (act === 'rename') {
      const p = list.find((x) => x.id === id);
      panel(id, `<form class="combo wide" data-form="rename" data-id="${id}">
        <input type="text" maxlength="30" value="${esc(p.name)}" aria-label="الاسم الجديد" required>
        <button type="submit" class="btn primary">حفظ</button></form>`);
    }
    if (act === 'delete') {
      const p = list.find((x) => x.id === id);
      panel(id, `<p class="verdict warn">${icon('alert')}<span>هيتمسح كل تقدم ${esc(p.name)} ونقاط ضعفه نهائياً. لو عاوز تحتفظ بيها احفظ «ملف الحفظ» الأول.</span></p>
        <div class="row actions"><button type="button" class="btn danger" data-act="delete-yes" data-id="${id}">${icon('trash', { size: 18 })}أيوه، احذف ${esc(p.name)}</button>
        <button type="button" class="btn ghost" data-act="cancel">إلغاء</button></div>`);
    }
    if (act === 'delete-yes') { const name = list.find((x) => x.id === id).name; deleteProfile(id); toast(`اتحذف ${name}`); go('people', {}, { push: false }); }
    if (act === 'cancel') go('people', {}, { push: false });
    if (act === 'export') await saveBackupFile();
  };
  app.onsubmit = (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.id === 'add-form') {
      const name = document.getElementById('new-name').value.trim();
      if (!name) { document.getElementById('name-error').hidden = false; document.getElementById('new-name').focus(); return; }
      const id = addProfile(name);
      switchProfile(id);
      toast(`أهلاً ${name} — اظبط خطتك`);
      go('home');
    }
    if (f.dataset.form === 'rename') {
      renameProfile(f.dataset.id, f.querySelector('input').value);
      go('people', {}, { push: false });
    }
  };
  document.getElementById('imp').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = importData(await file.text());
      toast(`تم فتح الملف: ${r.added ? `${ar(r.added)} شخص جديد` : ''}${r.added && r.replaced ? ' و' : ''}${r.replaced ? `${ar(r.replaced)} اتحدّث` : ''}`, 4000);
      go('people', {}, { push: false });
    } catch (err) { toast(`ما قدرتش أفتح الملف: ${err.message}`, 5000); }
  };
}

// حفظ ملف النسخة الاحتياطية: على الموبايل نفتح قائمة المشاركة (واتساب، Drive…) لو متاحة
async function saveBackupFile() {
  const name = `hifz-${dayKey()}.json`;
  const blob = new Blob([exportData()], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ملف حفظ رفيق الحفظ' });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('اتحفظ الملف في التنزيلات');
}

// تنبيه لو الخطة لا تغطي القرآن كله بسبب سورة البداية (مثلاً: البداية الفاتحة والاتجاه نحو الفاتحة)
function partialWarning(set) {
  const full = set.direction === 'backward' ? set.startSurah === 114 : set.startSurah === 1;
  if (full) return '';
  const end = set.direction === 'backward' ? 'الفاتحة' : 'الناس';
  const from = set.direction === 'backward' ? 'الناس' : 'الفاتحة';
  return `<div class="verdict warn small">${icon('alert', { size: 18 })}<span>الخطة دي من سورة ${surahName(set.startSurah)} لحد سورة ${end} بس، مش القرآن كله.
    <button type="button" class="btn small-btn" data-act="full-start">ابدأ من ${from} بدلاً من كده</button></span></div>`;
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
      <h1>${getProfiles().list.length > 1 ? `أهلاً ${esc(activeProfile().name)}` : 'أهلاً بك في رفيق الحفظ'}</h1>
      <p>خطة يومية فيها <b>حفظ جديد</b> و<b>مراجعة قريبة</b> و<b>مراجعة بعيدة</b> و<b>نقاط ضعفك</b>.
      وقت التسميع يكون النص مخفياً، وكل كلمة تقولها صح تظهر، ولو أخطأت أو نسيت يحفظها ويذكّرك بها حتى تثبت.</p>
      <p class="muted small">اضبط الخطة المناسبة لك — تقدر تغيرها في أي وقت.</p></section>`
    : '<header class="page-head"><h1>خطة الحفظ</h1></header>'}
    <form class="form" id="pf" novalidate>
      <fieldset class="card">
        <legend>${icon('sprout')}الحفظ الجديد</legend>
        <div class="field-row">
          <label class="field"><span>الاتجاه</span><select name="direction">
            <option value="backward" ${s.direction === 'backward' ? 'selected' : ''}>من الناس ناحية الفاتحة (جزء عمّ الأول)</option>
            <option value="forward" ${s.direction === 'forward' ? 'selected' : ''}>من الفاتحة ناحية الناس</option>
          </select></label>
          <label class="field"><span>ابدأ من سورة</span><select name="startSurah">${surahOptions(s.startSurah)}</select></label>
        </div>
        <div class="know-box">
          <button type="button" class="btn know-btn" data-act="placement">${icon('mic')}حافظ جزء منها؟ سمّعه</button>
          <p class="muted small">سمّع من حفظك، ومكان ما تقف يبدأ منه الحفظ الجديد. اللي قرأته يتسجّل محفوظ.</p>
        </div>
        <div class="field">
          <span id="amount-label">المقدار اليومي</span>
          <div class="combo" role="group" aria-labelledby="amount-label">
            <input type="number" name="amount" min="0.5" step="0.5" inputmode="decimal" value="${s.amount}" aria-label="المقدار">
            <select name="unit" aria-label="الوحدة">${unitOpts(s.unit)}</select>
          </div>
          <p class="muted small">الأسطر والصفحات حسب مصحف المدينة (١٥ سطر في الصفحة). الورد يبدأ دايماً من أول آية ويقف عند نهاية آية، فممكن يقل سطر أو يزيد حسب طول الآيات.</p>
          <div class="first-portion" id="first-portion" aria-live="polite"></div>
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
        <label class="switch"><input type="checkbox" name="voiceFix" ${s.voiceFix ? 'checked' : ''}><span class="track" aria-hidden="true"></span>
          <span>صحّحني بالصوت<small class="muted">لما تغلط في كلمة أو تنساها، القارئ يقولها لك صح على طول</small></span></label>
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
      <h2>ملف الحفظ والأشخاص</h2>
      <p class="muted small">احفظ ملف فيه تقدم كل الأشخاص، أو ضيف شخص جديد بخطة مستقلة.</p>
      <div class="row actions">
        <button type="button" class="btn" data-act="people">${icon('download')}ملف الحفظ والأشخاص</button>
      </div>
      <div class="danger-zone">
        <button type="button" class="btn ghost danger" data-act="reset">${icon('trash', { size: 18 })}ابدأ من الأول (${esc(activeProfile().name)})</button>
        <div id="reset-confirm" hidden></div>
      </div>
      <p class="muted small version">الإصدار ${ar(APP_VERSION)}</p>
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
      voiceFix: fd.get('voiceFix') === 'on',
      reminders: fd.get('reminders') === 'on',
      reminderTime: fd.get('reminderTime') || '20:00',
    };
  };
  const showProj = () => {
    const first = previewChunk(read());
    document.getElementById('first-portion').innerHTML = first.length
      ? `<b>ورد أول يوم:</b> ${esc(describeAyahs(first))}<br><span class="small">${describePosition(first)}</span>`
      : '';
    const p = projection(read());
    document.getElementById('proj').innerHTML = p.ayahs
      ? `<div class="proj-head">${icon('today')}<b>تقدير موعد الإتمام</b></div>
         <div class="proj-stats">
           <div><b>${ar(p.ayahs)}</b><span>آية متبقية</span></div>
           <div><b>${ar(p.studyDays)}</b><span>يوم حفظ</span></div>
           ${p.calendarDays < 60
             ? `<div><b>${ar(p.calendarDays)}</b><span>${p.calendarDays === 1 ? 'يوم' : 'يوم بالإجازات'}</span></div>`
             : `<div><b>${ar(Math.round(p.calendarDays / 30))}</b><span>شهر تقريباً</span></div>`}
         </div>
         <p class="small">تنتهي تقريباً <b>${formatDay(p.end)} ${ar(p.end.slice(0, 4))}</b> عند سورة ${surahName(p.last.s)}.</p>
         ${partialWarning(read())}`
      : `<div class="proj-head">${icon('checkCircle')}<b>كل الآيات في اتجاه هذه الخطة محفوظة</b></div>`;
    document.getElementById('prior-count').textContent = ar(form.querySelectorAll('input[name=prior]:checked').length);
  };
  // تغيير الاتجاه يحرك سورة البداية لأول السكة: الناس نزولاً أو الفاتحة صعوداً
  form.direction.onchange = () => {
    form.startSurah.value = form.direction.value === 'backward' ? '114' : '1';
  };
  form.oninput = () => {
    showProj();
    if (form.querySelector('input[name=day]:checked')) document.getElementById('days-error').hidden = true;
  };
  showProj();

  // حفظ الخطة (يُرجع false لو فيه خطأ في النموذج)
  const saveForm = () => {
    const next = read();
    if (!next.studyDays.length) {
      const err = document.getElementById('days-error');
      err.hidden = false;
      form.querySelector('input[name=day]').focus();
      err.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      return null;
    }
    const today = dayKey();
    update((x) => {
      x.settings = next;
      x.setupDone = true;
      // إعادة بناء خطة اليوم لو لم يُعتمد حفظ اليوم بعد
      if (x.days[today] && !x.days[today].tasks.new.done) delete x.days[today];
    });
    return next;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const next = saveForm();
    if (!next) return;
    if (next.reminders) await enableNotifications();
    toast('تم حفظ الخطة');
    go('home');
  };

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'placement') {
      const next = saveForm();
      if (next) go('placement', { s: next.startSurah, returnTo: 'plan' });
      return;
    }
    if (act === 'juz30') {
      form.querySelectorAll('input[name=prior]').forEach((c) => { if (Number(c.value) >= 78) c.checked = true; });
      showProj();
    }
    if (act === 'full-start') {
      form.startSurah.value = form.direction.value === 'backward' ? '114' : '1';
      showProj();
    }
    if (act === 'clearprior') { form.querySelectorAll('input[name=prior]').forEach((c) => { c.checked = false; }); showProj(); }
    if (act === 'ics') downloadIcs(read().reminderTime);
    if (act === 'people') go('people');
    if (act === 'reset') {
      const box = document.getElementById('reset-confirm');
      box.hidden = false;
      box.innerHTML = `<p class="verdict warn">${icon('alert')}<span>هيتمسح كل تقدم ${esc(activeProfile().name)} ونقاط ضعفه وخطته. الأشخاص التانيين مش هيتأثروا.</span></p>
        <div class="row actions"><button type="button" class="btn danger" data-act="reset-yes">أيوه، امسح</button>
        <button type="button" class="btn ghost" data-act="reset-no">إلغاء</button></div>`;
    }
    if (act === 'reset-no') document.getElementById('reset-confirm').hidden = true;
    if (act === 'reset-yes') { resetAll(); go('home'); }
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
  notify(getProfiles().list.length > 1 ? `ورد ${activeProfile().name} في انتظاره` : 'ورد اليوم في انتظارك', `${pending.map((t) => t.title).join(' · ')}${weak ? `\nعندك ${weak} كلمة من نقاط ضعفك تحتاج مراجعة` : ''}`);
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
    // التحديثات توصل لوحدها: نفحص عند فتح البرنامج والرجوع له، ونعيد التحميل مرة لما يجهز الإصدار الجديد
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; } // أول تثبيت، ليس تحديثاً
      // لا نقطع التسميع أو الحفظ؛ نعيد التحميل عند الرجوع لأي تبويب
      if (document.body.classList.contains('immersive')) reloadPending = true;
      else location.reload();
    });
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
