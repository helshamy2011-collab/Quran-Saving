import {
  loadQuran, surahName, ayahCount, toGlobal, fromGlobal, ayahWords, ayahText,
  describeAyahs, toArabicDigits, surahRangeLabel,
} from './quran.js';
import { getState, update, save, dayKey, formatDay, exportData, importData, resetAll, DEFAULT_SETTINGS } from './store.js';
import { todayPlan, recordSession, stats, projection, dueWeak, weakAyahs, UNIT_LABEL, WEAK_INTERVALS } from './plan.js';
import { Matcher, STATUS, isMistake } from './matcher.js';
import { Listener, speechSupported } from './speech.js';

const app = document.getElementById('app');
const tabs = document.getElementById('tabs');
let cleanup = null;

const STATUS_LABEL = {
  [STATUS.WRONG]: 'خطأ',
  [STATUS.SKIPPED]: 'أسقطها',
  [STATUS.HINT]: 'نسيها',
  [STATUS.CORRECTED]: 'تردد',
};
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const RECITERS = {
  Husary_128kbps: 'الحصري (مرتل)',
  Husary_Muallim_128kbps: 'الحصري (المعلم)',
  Minshawy_Murattal_128kbps: 'المنشاوي',
  Alafasy_128kbps: 'العفاسي',
  Abdul_Basit_Murattal_192kbps: 'عبد الباسط (مرتل)',
};

const ar = toArabicDigits;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- التنقل ----------
function go(view, params = {}) {
  if (cleanup) { cleanup(); cleanup = null; }
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === view);
  window.scrollTo(0, 0);
  const views = { home: renderHome, weak: renderWeak, free: renderFree, plan: renderPlan, study: renderStudy, recite: renderRecite };
  views[view](params);
  refreshBadge();
}

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
        weak: 'لا توجد نقاط ضعف مستحقة اليوم 👌',
        new: isStudyDay ? 'ما شاء الله! أتممت كل آيات الخطة 🎉' : 'اليوم يوم مراجعة فقط (لا حفظ جديد)',
        near: 'لا يوجد حفظ قريب بعد — سيظهر هنا ما تحفظه',
        far: 'سيظهر هنا محفوظك القديم بعد أن تحفظ',
      };
      range = `<div class="muted small">${empty[t.id]}</div>`;
    } else {
      range = `<div class="range">${esc(describeAyahs(t.ayahs))} <span class="muted small">(${ar(t.ayahs.length)} آية)</span></div>`;
      if (t.id === 'new' && !t.done) {
        actions = `<button class="btn" data-act="study">📖 احفظ واستمع</button>
                   <button class="btn primary" data-act="recite" data-task="new">🎤 سمّع</button>`;
      } else {
        actions = `<button class="btn ${t.done ? '' : 'primary'}" data-act="recite" data-task="${t.id}">🎤 ${t.done ? 'سمّع مرة أخرى' : 'سمّع'}</button>`;
      }
      if (t.done && t.accuracy != null) actions += ` <span class="tag ok">أتممتها بإتقان ${ar(t.accuracy)}٪</span>`;
    }
    return `<div class="card task ${t.done ? 'done' : ''}">
      <div class="icon">${t.icon}</div>
      <div class="body">
        <h3>${t.title}${t.id === 'weak' && t.count ? ` <span class="badge">${ar(t.count)} كلمة</span>` : ''}</h3>
        <div class="muted small">${t.desc}</div>
        ${range}
        <div class="row">${actions}</div>
      </div>
    </div>`;
  };

  const pending = plan.tasks.filter((t) => t.ayahs.length && !t.done).length;

  app.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <div><h1>${formatDay(plan.today)}</h1>
      <div class="muted">${pending ? `باقي لك ${ar(pending)} ${pending === 1 ? 'مهمة' : 'مهام'} اليوم` : 'أتممت ورد اليوم، بارك الله فيك 🌟'}</div></div>
    </div>
    ${weakTask.count ? `<div class="alert">🎯 <b>تذكير:</b> عندك <b>${ar(weakTask.count)}</b> كلمة أخطأت فيها أو نسيتها من قبل وحان وقت مراجعتها. ابدأ بها قبل أي شيء.</div>` : ''}
    <div class="grid" style="margin-bottom:14px">
      <div class="stat"><b>${ar(s.ayahs)}</b><span>آية محفوظة</span></div>
      <div class="stat"><b>${ar(s.pages.toFixed(1))}</b><span>صفحة تقريباً</span></div>
      <div class="stat"><b>${ar(s.streak)}</b><span>يوم متتالٍ 🔥</span></div>
      <div class="stat"><b>${ar(s.weakActive)}</b><span>نقطة ضعف تحت المتابعة</span></div>
    </div>
    <div class="card">
      <div class="row small muted"><span>التقدم في حفظ القرآن</span><span class="spacer"></span><span>${ar(s.percent.toFixed(1))}٪</span></div>
      <div class="progress"><i style="width:${Math.min(100, s.percent)}%"></i></div>
    </div>
    ${plan.tasks.map(taskCard).join('')}
    ${recentSessions()}
  `;

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'study') go('study');
    if (b.dataset.act === 'recite') {
      const t = plan.tasks.find((x) => x.id === b.dataset.task);
      go('recite', { taskId: t.id, label: t.title, ayahs: t.ayahs });
    }
  };
}

function recentSessions() {
  const list = getState().sessions.slice(0, 8);
  if (!list.length) return '';
  return `<div class="card"><h3>آخر جلسات التسميع</h3><ul class="mistake-list">
    ${list.map((x) => `<li><span>${esc(x.label)}</span><span class="spacer"></span>
      <span class="tag ${x.accuracy >= 90 ? 'ok' : x.accuracy >= 70 ? 'corrected' : 'wrong'}">${ar(x.accuracy)}٪</span>
      <span class="muted small">${ar(x.mistakes)} خطأ · ${formatDay(x.date)}</span></li>`).join('')}
  </ul></div>`;
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
    html += ` <span class="ayah-end">﴿${ar(a)}﴾</span><button class="ayah-play" data-g="${g}" title="استمع للآية">▶</button> `;
  }

  app.innerHTML = `
    <div class="recite-head">
      <button class="btn ghost" data-act="back">→ رجوع</button>
      <h2>الحفظ الجديد</h2>
      <span class="muted">${esc(describeAyahs(t.ayahs))}</span>
    </div>
    <div class="card small">
      <b>طريقة مقترحة:</b> استمع للآية ٣ مرات وأنت تنظر للمصحف، ثم اقرأها ٥ مرات، ثم اقرأها مغمض العينين.
      بعد ما تثبت كل الآيات اربطها ببعض، ثم اضغط "سمّع" — لازم تحقق ${ar(getState().settings.passMark)}٪ لاعتماد الحفظ.
    </div>
    <div class="row" style="margin-bottom:10px">
      <label>تكرار كل آية:
        <select id="repeat">${[1, 3, 5, 10].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${ar(n)} مرات</option>`).join('')}</select>
      </label>
      <button class="btn" data-act="play-all">▶ استمع للورد كله</button>
      <button class="btn" data-act="stop">⏹ إيقاف</button>
      <span class="muted small">القارئ: ${RECITERS[reciter] || reciter}</span>
    </div>
    <div class="mushaf study">${html}</div>
    <div class="dock"><div class="inner">
      <span class="heard">لما تحس إنك حفظت، ابدأ التسميع والنص هيكون مخفي.</span>
      <button class="btn primary big" data-act="recite">🎤 جاهز — سمّع</button>
    </div></div>
  `;

  const stopAudio = () => {
    if (audio) { audio.pause(); audio = null; }
    app.querySelectorAll('.ayah-play.playing').forEach((b) => b.classList.remove('playing'));
  };

  // تشغيل قائمة آيات مع تكرار كل آية
  const playQueue = (list) => {
    stopAudio();
    const rep = Number(document.getElementById('repeat').value);
    const queue = list.flatMap((g) => Array(rep).fill(g));
    const next = () => {
      const g = queue.shift();
      app.querySelectorAll('.ayah-play.playing').forEach((b) => b.classList.remove('playing'));
      if (g == null) { audio = null; return; }
      const { s, a } = fromGlobal(g);
      app.querySelector(`.ayah-play[data-g="${g}"]`)?.classList.add('playing');
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
    if (p) return playQueue([Number(p.dataset.g)]);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') go('home');
    if (act === 'play-all') playQueue(t.ayahs);
    if (act === 'stop') stopAudio();
    if (act === 'recite') go('recite', { taskId: 'new', label: 'الحفظ الجديد', ayahs: t.ayahs });
  };
  cleanup = stopAudio;
}

// ================= شاشة التسميع =================
function renderRecite({ taskId, label, ayahs, returnTo = 'home' }) {
  const st = getState();
  const weak = st.weak;
  const words = [];
  for (const g of ayahs) ayahWords(g).forEach((w, i) => words.push({ ...w, g, w: i }));
  const matcher = new Matcher(words);
  const manual = !speechSupported;

  // بناء النص المخفي
  let html = '';
  let prev = null;
  let idx = 0;
  for (const g of ayahs) {
    const { s, a } = fromGlobal(g);
    if (!prev || prev.s !== s || prev.a !== a - 1) {
      html += `<span class="surah-head">${a === 1 ? `سورة ${surahName(s)}` : `${surahName(s)} — من الآية ${ar(a)}`}</span>`;
    }
    prev = { s, a };
    const n = ayahWords(g).length;
    for (let i = 0; i < n; i++, idx++) {
      const wk = st.settings.warnWeak && weak[`${g}:${i}`] && !weak[`${g}:${i}`].mastered;
      html += `<span class="w hidden ${wk ? 'weak-mark' : ''}" data-i="${idx}">${words[idx].text}</span> `;
    }
    html += `<span class="ayah-end">﴿${ar(a)}﴾</span> `;
  }

  app.innerHTML = `
    <div class="recite-head">
      <button class="btn ghost" data-act="back">→ رجوع</button>
      <h2>${esc(label)}</h2>
      <span class="muted small">${esc(describeAyahs(ayahs))}</span>
      <span class="spacer"></span>
      <span id="score" class="tag ok"></span>
    </div>
    <div class="progress" style="margin-bottom:10px"><i id="bar" style="width:0"></i></div>
    ${manual ? `<div class="alert">متصفحك لا يدعم التعرف على الصوت. استخدم Chrome أو Edge أو Safari للتسميع بالصوت.
      الآن تقدر تسمّع بنفسك: اضغط <b>"✓ قلتها صح"</b> لكشف الكلمة، أو <b>"💡 نسيتها"</b> لو نسيت.</div>` : ''}
    <div class="legend">
      <span><i style="background:var(--hidden)"></i>مخفية</span>
      <span><i style="background:var(--bad-bg);border:1px solid var(--bad)"></i>خطأ / أسقطها</span>
      <span><i style="background:var(--hint-bg);border:1px solid var(--hint)"></i>نسيتها</span>
      <span><i style="background:var(--warn-bg);border:1px solid var(--warn)"></i>تردد</span>
      ${st.settings.warnWeak ? '<span><i style="box-shadow:inset 0 -3px 0 var(--warn);background:var(--hidden)"></i>أخطأت فيها سابقاً — ركّز</span>' : ''}
    </div>
    <div class="mushaf" id="mushaf">${html}</div>
    <p class="muted small" style="margin-top:8px">💡 لو البرنامج فهمك غلط، اضغط على الكلمة الحمراء لتصحيحها (والعكس).</p>
    <div id="result"></div>
    <div class="dock" id="dock"><div class="inner">
      ${manual
        ? '<button class="btn primary big" data-act="ok">✓ قلتها صح</button>'
        : '<button class="mic" id="mic" data-act="mic" title="ابدأ/أوقف الاستماع">🎤</button>'}
      <div class="heard" id="heard">${manual ? 'مسافة = صح · H = نسيتها · Z = تراجع' : 'اضغط على الميكروفون وابدأ القراءة…'}</div>
      <button class="btn" data-act="hint" id="hint-btn">💡 نسيتها</button>
      <button class="btn" data-act="undo" title="تراجع">↩</button>
      <button class="btn" data-act="finish">إنهاء</button>
    </div></div>
  `;

  const spans = [...app.querySelectorAll('#mushaf .w')];
  const heardEl = document.getElementById('heard');
  const micBtn = document.getElementById('mic');
  const hintBtn = document.getElementById('hint-btn');
  let prevStatus = matcher.status.slice();
  let lastProgress = Date.now();
  let finished = false;

  const paint = () => {
    matcher.status.forEach((stt, i) => {
      if (stt === prevStatus[i] && !(i === matcher.pos || i === matcher.pos - 1)) return;
      const el = spans[i];
      const weakMark = el.classList.contains('weak-mark');
      el.className = `w ${stt}${weakMark ? ' weak-mark' : ''}`;
      if (stt !== STATUS.HIDDEN) el.classList.add('revealed');
      if (stt !== prevStatus[i] && stt !== STATUS.HIDDEN) el.classList.add('just');
    });
    if (!matcher.done) {
      spans[matcher.pos].classList.add('current');
      const r = spans[matcher.pos].getBoundingClientRect();
      if (r.bottom > window.innerHeight - 140 || r.top < 120) spans[matcher.pos].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (matcher.status.some((x, i) => x !== prevStatus[i])) lastProgress = Date.now();
    prevStatus = matcher.status.slice();
    const sc = matcher.score();
    document.getElementById('bar').style.width = `${(sc.done / sc.total) * 100}%`;
    const scoreEl = document.getElementById('score');
    scoreEl.textContent = sc.done ? `${ar(sc.accuracy)}٪ · ${ar(sc.mistakes)} خطأ` : '';
    scoreEl.className = `tag ${sc.accuracy >= 90 ? 'ok' : sc.accuracy >= 70 ? 'corrected' : 'wrong'}`;
    hintBtn.classList.remove('nudge');
    if (matcher.done && !finished) finish();
  };

  // ---- الاستماع ----
  const consumed = new Map();
  const listener = manual ? null : new Listener({
    lang: st.settings.lang,
    onWords(tokens, isFinal, key, alts) {
      if (finished) return;
      heardEl.textContent = `سمعت: ${tokens.join(' ')}`;
      const used = consumed.get(key) || 0;
      if (!isFinal) {
        const n = matcher.feedInterim(tokens.slice(used));
        if (n) { consumed.set(key, used + n); paint(); }
        return;
      }
      // نختار من بدائل التعرف الأقرب للنص
      let best = alts[0];
      let bestScore = -Infinity;
      for (const alt of alts) {
        const c = matcher.clone();
        c.feedFinal(alt.slice(used));
        let sc = 0;
        c.status.forEach((x, i) => {
          if (x === matcher.status[i]) return;
          sc += isMistake(x) ? -2 : 1;
        });
        if (sc > bestScore) { bestScore = sc; best = alt; }
      }
      matcher.snapshot();
      matcher.feedFinal(best.slice(used));
      consumed.delete(key);
      paint();
    },
    onState(state) {
      if (!micBtn) return;
      micBtn.classList.toggle('on', state === 'listening' || listener.active);
      micBtn.textContent = listener.active ? '⏸' : '🎤';
    },
    onError(msg) { toast(msg, 5000); heardEl.textContent = msg; micBtn?.classList.remove('on'); },
  });

  // تنبيه لو توقف طويلاً: "نسيت؟"
  const stallTimer = setInterval(() => {
    if (!finished && listener?.active && Date.now() - lastProgress > 7000) {
      hintBtn.classList.add('nudge');
      heardEl.textContent = 'توقفت؟ لو نسيت الكلمة اضغط "نسيتها" وسأكشفها لك وأسجلها للمراجعة.';
    }
  }, 1000);

  const doHint = () => { matcher.snapshot(); matcher.hint(); paint(); };
  const doOk = () => { matcher.snapshot(); matcher.revealOk(); paint(); };
  const doUndo = () => {
    if (!matcher.undo()) return;
    prevStatus = prevStatus.map(() => null);
    paint();
  };

  function finish() {
    finished = true;
    listener?.stop();
    clearInterval(stallTimer);
    const sc = matcher.score();
    if (!sc.done) { go(returnTo); return; }
    recordSession({ taskId, label, words, status: matcher.status, score: sc });
    refreshBadge();
    const mistakes = matcher.status.map((x, i) => ({ x, i })).filter((o) => isMistake(o.x));
    const passMark = getState().settings.passMark;
    const complete = sc.done === sc.total;
    let verdict = '';
    if (taskId === 'new') {
      verdict = complete && sc.accuracy >= passMark
        ? `<p>✅ تم اعتماد الحفظ الجديد. ستظهر هذه الآيات في المراجعة القريبة الأيام القادمة.</p>`
        : `<p>⚠️ تحتاج ${ar(passMark)}٪ على الأقل مع إكمال الورد لاعتماد الحفظ. راجع المواضع الملونة وأعد التسميع.</p>`;
    }
    document.getElementById('dock').hidden = true;
    const res = document.getElementById('result');
    res.innerHTML = `<div class="card">
      <div class="row">
        <div class="result-score ${sc.accuracy < 80 ? 'low' : ''}">${ar(sc.accuracy)}٪</div>
        <div><b>${sc.accuracy >= 95 ? 'ممتاز، بارك الله فيك' : sc.accuracy >= 80 ? 'جيد، ثبّت المواضع الملونة' : 'تحتاج تثبيتاً أكثر'}</b>
        <div class="muted small">${ar(sc.done)} من ${ar(sc.total)} كلمة · ${ar(sc.mistakes)} خطأ</div></div>
      </div>
      ${verdict}
      ${mistakes.length ? `<h3 style="margin-top:10px">حفظتُ لك هذه المواضع للمراجعة:</h3><ul class="mistake-list">
        ${mistakes.map(({ x, i }) => {
          const w = words[i];
          const { s, a } = fromGlobal(w.g);
          const all = ayahWords(w.g);
          const ctx = all.slice(Math.max(0, w.w - 2), w.w + 3).map((y, k) => (Math.max(0, w.w - 2) + k === w.w ? `<b style="color:var(--bad)">${y.text}</b>` : y.text)).join(' ');
          return `<li><span class="tag ${x}">${STATUS_LABEL[x]}</span><span class="q">${ctx}</span><span class="muted small">${surahName(s)} ${ar(a)}</span></li>`;
        }).join('')}
      </ul><p class="muted small">ستظهر لك في "نقاط الضعف" غداً، ثم بعد يومين، ثم ٤، ثم أسبوع… حتى تثبت تماماً.</p>` : '<p>لا أخطاء! 🌟</p>'}
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-act="again">🔁 سمّع مرة أخرى</button>
        ${mistakes.length ? '<button class="btn" data-act="again-weak">🎯 سمّع آيات الأخطاء فقط</button>' : ''}
        <button class="btn" data-act="back">رجوع</button>
      </div>
    </div>`;
    res.scrollIntoView({ behavior: 'smooth' });
    res.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'again') go('recite', { taskId, label, ayahs, returnTo });
      if (b.dataset.act === 'again-weak') {
        const list = [...new Set(mistakes.map(({ i }) => words[i].g))];
        go('recite', { taskId: 'weak', label: 'آيات الأخطاء', ayahs: list, returnTo });
      }
      if (b.dataset.act === 'back') go(returnTo);
    };
  }

  app.onclick = (e) => {
    const w = e.target.closest('#mushaf .w');
    if (w && !finished) {
      const i = Number(w.dataset.i);
      if (i < matcher.pos) { matcher.snapshot(); matcher.toggle(i); prevStatus[i] = null; paint(); }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.closest('#result')) return;
    const act = b.dataset.act;
    if (act === 'back') go(returnTo);
    if (act === 'mic') { if (listener.active) listener.stop(); else { listener.start(); lastProgress = Date.now(); } }
    if (act === 'hint') doHint();
    if (act === 'ok') doOk();
    if (act === 'undo') doUndo();
    if (act === 'finish') {
      if (matcher.pos === 0 || confirm('إنهاء التسميع الآن؟ سيتم حفظ ما سمّعته حتى الآن.')) finish();
    }
  };

  const onKey = (e) => {
    if (finished || e.target.matches('input, select')) return;
    if (e.code === 'Space') { e.preventDefault(); if (manual) doOk(); else micBtn.click(); }
    if (e.key === 'h' || e.key === 'H' || e.key === 'ا') doHint();
    if (e.key === 'z' || e.key === 'Z' || e.key === 'ئ') doUndo();
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => {
    finished = true;
    listener?.stop();
    clearInterval(stallTimer);
    document.removeEventListener('keydown', onKey);
  };
  paint();
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
    return `<div class="card weak-ayah">
      <div class="row small"><b>${surahName(s)} ${ar(a)}</b>
        <span class="tag wrong">${ar(misses)} ${misses === 1 ? 'خطأ' : 'أخطاء'}</span>
        <span class="boxes" title="مراحل التثبيت">${WEAK_INTERVALS.map((_, k) => `<i class="${k < box ? 'on' : ''}"></i>`).join('')}</span>
        <span class="spacer"></span>
        <span class="${nextDue <= today ? '' : 'muted'}">${nextDue <= today ? '⏰ مستحقة الآن' : `المراجعة: ${formatDay(nextDue)}`}</span>
      </div>
      <div class="q">${text}</div>
      <div class="row">
        <button class="btn small primary" data-act="one" data-g="${g}">🎤 سمّعها</button>
        <button class="btn small ghost danger" data-act="del" data-g="${g}">إزالة</button>
      </div>
    </div>`;
  };

  app.innerHTML = `
    <h1>نقاط الضعف</h1>
    <p class="muted">كل كلمة تخطئ فيها أو تنساها أو تتردد فيها تُحفظ هنا تلقائياً، وتظهر لك للمراجعة على فترات متباعدة
      (${WEAK_INTERVALS.map(ar).join('، ')} يوم). كل مرة تقرأها صح تنتقل لمرحلة أبعد، ولو أخطأت فيها ترجع من الأول.</p>
    <div class="grid" style="margin-bottom:14px">
      <div class="stat"><b>${ar(due.length)}</b><span>مستحقة اليوم</span></div>
      <div class="stat"><b>${ar(active.length)}</b><span>تحت المتابعة</span></div>
      <div class="stat"><b>${ar(items.length - active.length)}</b><span>ثبتت والحمد لله</span></div>
    </div>
    <div class="row" style="margin-bottom:14px">
      <button class="btn primary" data-act="due" ${due.length ? '' : 'disabled'}>🎯 سمّع المستحق الآن (${ar(weakAyahs(due).length)} آية)</button>
      <button class="btn" data-act="all" ${active.length ? '' : 'disabled'}>سمّع كل نقاط الضعف</button>
    </div>
    ${groups.length ? groups.map(ayahCard).join('') : '<div class="card muted">لا توجد نقاط ضعف حتى الآن. ابدأ التسميع وسيتابع البرنامج أخطاءك تلقائياً.</div>'}
  `;

  app.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'due') go('recite', { taskId: 'weak', label: 'نقاط الضعف', ayahs: weakAyahs(due), returnTo: 'weak' });
    if (act === 'all') go('recite', { taskId: 'weak-all', label: 'كل نقاط الضعف', ayahs: [...byAyah.keys()].sort((x, y) => x - y).slice(0, 30), returnTo: 'weak' });
    if (act === 'one') go('recite', { taskId: 'weak-one', label: 'نقطة ضعف', ayahs: [Number(b.dataset.g)], returnTo: 'weak' });
    if (act === 'del') {
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
    <h1>تسميع حر</h1>
    <p class="muted">اختر أي سورة أو مقطع وسمّعه. الأخطاء هنا أيضاً تُضاف لنقاط الضعف.</p>
    <div class="card">
      <label class="field"><span>السورة</span><select id="fs">${surahOptions(last.s)}</select></label>
      <div class="row">
        <label class="field"><span>من الآية</span><input type="number" id="ff" min="1" value="${last.from}" style="width:90px"></label>
        <label class="field"><span>إلى الآية</span><input type="number" id="ft" min="1" value="${last.to}" style="width:90px"></label>
        <button class="btn small" id="fall" style="margin-top:14px">السورة كاملة</button>
      </div>
      <button class="btn primary big" id="fgo">🎤 ابدأ التسميع</button>
    </div>`;
  const fs = document.getElementById('fs');
  const ff = document.getElementById('ff');
  const ft = document.getElementById('ft');
  const clamp = () => {
    const n = ayahCount(Number(fs.value));
    ff.max = n; ft.max = n;
    if (Number(ft.value) > n) ft.value = n;
    if (Number(ff.value) > n) ff.value = 1;
  };
  fs.onchange = () => { ff.value = 1; ft.value = ayahCount(Number(fs.value)); clamp(); };
  document.getElementById('fall').onclick = () => { ff.value = 1; ft.value = ayahCount(Number(fs.value)); };
  clamp();
  document.getElementById('fgo').onclick = () => {
    const s = Number(fs.value);
    let from = Math.max(1, Number(ff.value) || 1);
    let to = Math.min(ayahCount(s), Number(ft.value) || from);
    if (to < from) [from, to] = [to, from];
    localStorage.setItem('free-last', JSON.stringify({ s, from, to }));
    const ayahs = [];
    for (let a = from; a <= to; a++) ayahs.push(toGlobal(s, a));
    go('recite', { taskId: 'free', label: 'تسميع حر', ayahs, returnTo: 'free' });
  };
  app.onclick = null;
}

// ================= الخطة والإعدادات =================
function renderPlan({ welcome = false } = {}) {
  const st = getState();
  const s = st.settings;
  const unitOpts = (sel) => Object.entries(UNIT_LABEL).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  const prior = new Set(s.prior);

  app.innerHTML = `
    ${welcome ? `<div class="card"><h1>أهلاً بك في رفيق الحفظ 🌿</h1>
      <p>البرنامج يعمل لك خطة يومية: <b>حفظ جديد</b> + <b>مراجعة قريبة</b> + <b>مراجعة بعيدة</b> + <b>نقاط ضعفك</b>.
      وقت التسميع يكون النص مخفياً، وكل كلمة تقولها صح تظهر، ولو أخطأت أو نسيت يحفظها ويذكّرك بها حتى تثبت.</p>
      <p class="muted small">ابدأ بضبط الخطة المناسبة لك (تقدر تغيرها في أي وقت).</p></div>` : '<h1>خطة الحفظ</h1>'}
    <form class="card" id="pf">
      <h2>الحفظ الجديد</h2>
      <div class="row">
        <label class="field"><span>ابدأ من سورة</span><select name="startSurah">${surahOptions(s.startSurah)}</select></label>
        <label class="field"><span>الاتجاه</span><select name="direction">
          <option value="backward" ${s.direction === 'backward' ? 'selected' : ''}>نزولاً نحو الفاتحة (مثلاً من الناس ← جزء عمّ أولاً)</option>
          <option value="forward" ${s.direction === 'forward' ? 'selected' : ''}>صعوداً نحو الناس (من البقرة مثلاً)</option>
        </select></label>
      </div>
      <div class="row">
        <label class="field"><span>المقدار اليومي</span><input type="number" name="amount" min="1" step="0.5" value="${s.amount}" style="width:90px"></label>
        <label class="field"><span>&nbsp;</span><select name="unit">${unitOpts(s.unit)}</select></label>
      </div>
      <label class="field"><span>أيام الحفظ الجديد</span>
        <div class="chips">${WEEKDAYS.map((d, i) => `<label class="chip"><input type="checkbox" name="day" value="${i}" ${s.studyDays.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
        <span class="muted small" style="font-weight:400">الأيام غير المختارة تكون للمراجعة فقط.</span>
      </label>
      <label class="field"><span>نسبة الإتقان المطلوبة لاعتماد الحفظ</span>
        <select name="passMark">${[80, 85, 90, 95, 100].map((n) => `<option value="${n}" ${n === s.passMark ? 'selected' : ''}>${ar(n)}٪</option>`).join('')}</select></label>

      <h2 style="margin-top:8px">المراجعة</h2>
      <div class="row">
        <label class="field"><span>المراجعة القريبة: آخر</span>
          <select name="nearDays">${[3, 5, 7, 10, 14, 30].map((n) => `<option value="${n}" ${n === s.nearDays ? 'selected' : ''}>${ar(n)} أيام</option>`).join('')}</select></label>
        <label class="field"><span>المراجعة البعيدة يومياً</span><input type="number" name="farAmount" min="0.5" step="0.5" value="${s.farAmount}" style="width:90px"></label>
        <label class="field"><span>&nbsp;</span><select name="farUnit">${unitOpts(s.farUnit)}</select></label>
      </div>
      <details ${welcome ? 'open' : ''}><summary>سور حفظتها من قبل (${ar(prior.size)}) — تدخل في المراجعة البعيدة</summary>
        <div class="surah-grid chips" style="margin-top:8px">
          ${Array.from({ length: 114 }, (_, k) => k + 1).map((n) => `<label class="chip"><input type="checkbox" name="prior" value="${n}" ${prior.has(n) ? 'checked' : ''}>${surahName(n)}</label>`).join('')}
        </div>
        <div class="row" style="margin-top:6px">
          <button type="button" class="btn small" data-act="juz30">تحديد جزء عمّ</button>
          <button type="button" class="btn small" data-act="clearprior">إلغاء الكل</button>
        </div>
      </details>

      <h2 style="margin-top:14px">التسميع والتذكير</h2>
      <div class="row">
        <label class="field"><span>لهجة التعرف على الصوت</span><select name="lang">
          ${[['ar-SA', 'العربية (السعودية)'], ['ar-EG', 'العربية (مصر)'], ['ar-AE', 'العربية (الإمارات)'], ['ar-JO', 'العربية (الأردن)'], ['ar-MA', 'العربية (المغرب)']].map(([v, l]) => `<option value="${v}" ${v === s.lang ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <label class="field"><span>القارئ (للاستماع)</span><select name="reciter">
          ${Object.entries(RECITERS).map(([v, l]) => `<option value="${v}" ${v === s.reciter ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <label class="chip" style="margin-bottom:12px"><input type="checkbox" name="warnWeak" ${s.warnWeak ? 'checked' : ''}>نبّهني على مواضع أخطائي السابقة وقت التسميع (خط برتقالي تحت الكلمة المخفية)</label>
      <div class="row">
        <label class="chip"><input type="checkbox" name="reminders" ${s.reminders ? 'checked' : ''}>ذكّرني يومياً</label>
        <label>الساعة <input type="time" name="reminderTime" value="${s.reminderTime}"></label>
        <button type="button" class="btn small" data-act="ics">📅 أضف تذكيراً يومياً للتقويم</button>
      </div>
      <p class="muted small">إشعارات المتصفح تعمل والبرنامج مفتوح أو مثبّت على الشاشة الرئيسية. للتذكير المضمون أضفه للتقويم في موبايلك.</p>

      <div class="card" id="proj" style="background:var(--surface-2);box-shadow:none"></div>
      <button class="btn primary big" type="submit">${welcome ? 'ابدأ الخطة' : 'حفظ الخطة'}</button>
    </form>

    ${welcome ? '' : `<div class="card">
      <h2>نسخة احتياطية</h2>
      <p class="muted small">بياناتك محفوظة على هذا الجهاز فقط. صدّرها لنقلها لجهاز آخر.</p>
      <div class="row">
        <button class="btn" data-act="export">⬇ تصدير</button>
        <label class="btn">⬆ استيراد<input type="file" id="imp" accept="application/json" hidden></label>
        <span class="spacer"></span>
        <button class="btn danger ghost" data-act="reset">مسح كل البيانات</button>
      </div>
    </div>`}
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
      ? `📆 بهذه الخطة: متبقٍّ <b>${ar(p.ayahs)}</b> آية في اتجاه الحفظ، تحتاج حوالي <b>${ar(p.studyDays)}</b> يوم حفظ
         ≈ <b>${ar(Math.round(p.calendarDays / 30))}</b> شهر، وتنتهي تقريباً <b>${formatDay(p.end)} ${ar(p.end.slice(0, 4))}</b>
         عند سورة ${surahName(p.last.s)}.
         <div class="muted small">لختم القرآن كاملاً اجعل البداية من الناس نزولاً أو من الفاتحة صعوداً.</div>`
      : '✅ كل الآيات في اتجاه هذه الخطة محفوظة.';
  };
  form.oninput = showProj;
  showProj();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const next = read();
    if (!next.studyDays.length) { toast('اختر يوماً واحداً على الأقل للحفظ'); return; }
    const today = dayKey();
    update((x) => {
      x.settings = next;
      x.setupDone = true;
      // إعادة بناء خطة اليوم لو لم يُعتمد حفظ اليوم بعد
      if (x.days[today] && !x.days[today].tasks.new.done) delete x.days[today];
    });
    if (next.reminders) await enableNotifications();
    toast('تم حفظ الخطة ✓');
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
    try { importData(await imp.files[0].text()); toast('تم الاستيراد ✓'); go('home'); } catch (err) { toast(`فشل الاستيراد: ${err.message}`); }
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
  notify('ورد اليوم في انتظارك 📖', `${pending.map((t) => t.title).join(' · ')}${weak ? `\nعندك ${weak} كلمة من نقاط ضعفك تحتاج مراجعة` : ''}`);
}

function downloadIcs(time) {
  const [h, m] = time.split(':');
  const d = dayKey().replace(/-/g, '');
  const url = location.href.split('#')[0];
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rafiq Al-Hifz//AR', 'BEGIN:VEVENT',
    `UID:hifz-daily-${d}@rafiq`, `DTSTAMP:${d}T000000Z`,
    `DTSTART:${d}T${h}${m}00`, 'DURATION:PT30M',
    'RRULE:FREQ=DAILY', 'SUMMARY:ورد حفظ القرآن 📖',
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
  go('home');
  checkReminder();
  setInterval(checkReminder, 60 * 1000);
  // لو بقي البرنامج مفتوحاً لليوم التالي نحدث الرئيسية
  let day = dayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dayKey() !== day) {
      day = dayKey();
      if (!cleanup) go('home');
    }
  });
}

boot();

// للاختبار من الكونسول
window.__hifz = { getState, save, DEFAULT_SETTINGS, ayahText, surahRangeLabel };
