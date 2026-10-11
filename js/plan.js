// خطة الحفظ: الحفظ الجديد + المراجعة القريبة + المراجعة البعيدة + نقاط الضعف

import { getState, update, dayKey, addDays } from './store.js';
import { toGlobal, ayahCount, totalAyahs, fromGlobal, toArabicDigits, linesCount, ayahPage, startsMidLine, LINES_PER_PAGE } from './quran.js';
import { STATUS, isMistake } from './matcher.js';

// الأسطر والصفحات حقيقية من مصحف المدينة (٦٠٤ صفحة × ١٥ سطراً)
export const UNIT_LABEL = { ayah: 'آية', line: 'سطر', page: 'صفحة' };

// مراحل مراجعة نقطة الضعف (بالأيام): كل مرة تقرأها صح تتباعد المراجعة
export const WEAK_INTERVALS = [1, 2, 4, 7, 15, 30];

// ترتيب الآيات حسب اتجاه الحفظ
export function planOrder(settings) {
  const surahs = [];
  if (settings.direction === 'backward') {
    for (let s = settings.startSurah; s >= 1; s--) surahs.push(s);
  } else {
    for (let s = settings.startSurah; s <= 114; s++) surahs.push(s);
  }
  const order = [];
  for (const s of surahs) for (let a = 1; a <= ayahCount(s); a++) order.push(toGlobal(s, a));
  return order;
}

// حجم مجموعة آيات بالوحدة المطلوبة (عدد آيات، أو أسطر/صفحات المصحف الفعلية)
export function unitSize(list, unit) {
  if (unit === 'ayah') return list.length;
  const lines = linesCount(list);
  return unit === 'page' ? lines / LINES_PER_PAGE : lines;
}

// يأخذ آيات من القائمة حتى يكتمل المقدار المطلوب.
// الورد يبدأ دائماً من أول آية ويقف عند نهاية آية (لا نقطع الآية):
// - صفحات كاملة: كل آيات الصفحة (صفحات مصحف المدينة تبدأ وتنتهي بآية)
// - أسطر (أو نصف صفحة): نضيف الآية التالية لو جعلت عدد الأسطر أقرب للمطلوب
function takeChunk(list, unit, amount) {
  if (unit === 'ayah') return list.slice(0, Math.max(1, Math.round(amount)));
  if (unit === 'page' && Number.isInteger(amount)) {
    const pages = new Set();
    const out = [];
    for (const g of list) {
      const p = ayahPage(g);
      if (!pages.has(p) && pages.size >= amount) break;
      pages.add(p);
      out.push(g);
    }
    return out;
  }
  const budget = Math.max(1, Math.round(unit === 'page' ? amount * LINES_PER_PAGE : amount));
  // لو الورد بدأ من وسط سطر، فهذا السطر اتحسب في ورد أمس، فلا نحسبه مرتين
  const shared = list.length && startsMidLine(list[0]) ? 1 : 0;
  const out = [];
  let count = 0;
  for (const g of list) {
    const next = linesCount([...out, g]) - shared;
    if (out.length && next > budget && next - budget >= budget - count) break;
    out.push(g);
    count = next;
    if (count >= budget) break;
  }
  return out;
}

export function memorizedSet(state = getState()) {
  const set = new Set(state.memorized);
  for (const s of state.settings.prior) for (let a = 1; a <= ayahCount(s); a++) set.add(toGlobal(s, a));
  return set;
}

export function remainingNew(state = getState()) {
  const known = memorizedSet(state);
  return planOrder(state.settings).filter((g) => !known.has(g));
}

function nearAyahs(state, today) {
  const since = addDays(today, -state.settings.nearDays);
  const out = new Set();
  for (const p of state.portions) if (p.date >= since && p.date < today) p.ayahs.forEach((g) => out.add(g));
  return [...out].sort((a, b) => a - b);
}

function farChunk(state, near) {
  const nearSet = new Set(near);
  const pool = [...memorizedSet(state)].filter((g) => !nearSet.has(g)).sort((a, b) => a - b);
  if (!pool.length) return [];
  let start = pool.findIndex((g) => g >= state.farCursor);
  if (start < 0) start = 0;
  const rotated = pool.slice(start).concat(pool.slice(0, start));
  return takeChunk(rotated, state.settings.farUnit, state.settings.farAmount);
}

export function dueWeak(state = getState(), today = dayKey()) {
  return Object.values(state.weak).filter((w) => !w.mastered && w.due <= today);
}

export function weakAyahs(items) {
  return [...new Set(items.map((w) => w.g))].sort((a, b) => a - b).slice(0, 20);
}

// خطة اليوم (تُحسب مرة واحدة في اليوم وتُحفظ حتى لا تتغير)
export function todayPlan() {
  const today = dayKey();
  const state = getState();
  if (!state.days[today]) {
    const weekday = new Date().getDay();
    const isStudyDay = state.settings.studyDays.includes(weekday);
    // لو حفظ الأمس لم يكتمل، يبقى هو نفسه حفظ اليوم
    const remaining = remainingNew(state);
    const newAyahs = isStudyDay ? takeChunk(remaining, state.settings.unit, state.settings.amount) : [];
    const near = nearAyahs(state, today);
    const far = farChunk(state, near);
    update((s) => {
      s.days[today] = {
        tasks: {
          new: { ayahs: newAyahs, done: false },
          near: { ayahs: near, done: false },
          far: { ayahs: far, done: false },
        },
        weakDone: false,
      };
      // تنظيف الأيام القديمة
      const keys = Object.keys(s.days).sort();
      while (keys.length > 60) delete s.days[keys.shift()];
    });
  }
  const day = getState().days[today];
  const weak = dueWeak();
  return {
    today,
    tasks: [
      { id: 'weak', title: 'نقاط الضعف', icon: 'target', desc: 'الكلمات التي أخطأت فيها أو نسيتها وحان وقت مراجعتها', ayahs: weakAyahs(weak), done: !weak.length && day.weakDone, count: weak.length },
      { id: 'new', title: 'الحفظ الجديد', icon: 'sprout', desc: 'احفظ الورد ثم سمّعه', ...day.tasks.new },
      { id: 'near', title: 'المراجعة القريبة', icon: 'repeat', desc: `ما حفظته في آخر ${toArabicDigits(getState().settings.nearDays)} أيام`, ...day.tasks.near },
      { id: 'far', title: 'المراجعة البعيدة', icon: 'book', desc: 'دورة على كل محفوظك القديم', ...day.tasks.far },
    ],
  };
}

// ---------- تسجيل نتيجة جلسة تسميع ----------
// words: [{g, w}] — status: حالة كل كلمة من المحرك
// تحديث نقاط الضعف من نتيجة تسميع من الحفظ
function applyWeak(s, words, status, today, confused = []) {
  words.forEach((word, i) => {
      const st = status[i];
      if (st === STATUS.HIDDEN) return;
      const key = `${word.g}:${word.w}`;
      const item = s.weak[key];
      if (isMistake(st)) {
        // كلمة يخطئ فيها التعرف حتى وهو يقرأ بالنظر: "خطأ/تردد" هنا غالباً سوء فهم لا نسيان
        if ((st === STATUS.WRONG || st === STATUS.CORRECTED || st === STATUS.SKIPPED) && isReadIssue(word.g, word.w, s)) return;
        const it = item || { g: word.g, w: word.w, misses: 0, hits: 0, history: [] };
        it.misses++;
        it.box = 0;
        it.mastered = false;
        it.kind = st;
        if (confused[i] != null) it.with = confused[i]; // خلط بآية متشابهة
        it.last = today;
        it.due = addDays(today, WEAK_INTERVALS[0]);
        it.history = [...(it.history || []), { d: today, st }].slice(-10);
        s.weak[key] = it;
      } else if (item && !item.mastered && item.lastHit !== today && item.last !== today) {
        // قرأها صح في يوم لاحق → ننقلها لمرحلة أبعد
        item.hits++;
        item.lastHit = today;
        item.box = (item.box || 0) + 1;
        if (item.box >= WEAK_INTERVALS.length) item.mastered = true;
        else item.due = addDays(today, WEAK_INTERVALS[item.box]);
      }
  });
}

// القراءة والمصحف مفتوح: تحدد الكلمات الصعبة في النطق (أو التي لا يفهمها التعرف الصوتي)
// وليست أخطاء حفظ، فلا تدخل نقاط الضعف
function applyReading(s, words, status, today) {
  s.readIssues ||= {};
  words.forEach((word, i) => {
    const st = status[i];
    if (st === STATUS.HIDDEN) return;
    const key = `${word.g}:${word.w}`;
    const item = s.readIssues[key];
    if (isMistake(st)) s.readIssues[key] = { n: (item?.n || 0) + 1, ok: item?.ok || 0, last: today };
    else if (item) { item.ok = (item.ok || 0) + 1; if (item.ok >= 3 && item.ok > item.n) delete s.readIssues[key]; }
  });
}

// هل هذه الكلمة صعبة حتى في القراءة بالنظر؟
export function isReadIssue(g, w, state = getState()) {
  const it = state.readIssues?.[`${g}:${w}`];
  return !!it && it.n > (it.ok || 0) / 2;
}

// تسجيل جلسة تدريب (وضع حفّظني أو قراءة بالنظر) بدون إنجاز مهام اليوم
// memory: [{words, status}] نتائج من الحفظ — reading: [{words, status}] نتائج بالنظر
export function recordPractice({ label, memory = [], reading = [], score }) {
  const today = dayKey();
  update((s) => {
    for (const r of reading) applyReading(s, r.words, r.status, today);
    for (const r of memory) applyWeak(s, r.words, r.status, today);
    if (score) {
      s.sessions.unshift({ date: today, time: Date.now(), taskId: 'practice', label, ...score });
      s.sessions = s.sessions.slice(0, 300);
    }
  });
}

export function recordSession({ taskId, label, words, status, score, reading = false, confused = [] }) {
  const today = dayKey();
  update((s) => {
    if (reading) applyReading(s, words, status, today);
    else applyWeak(s, words, status, today, confused);

    const day = s.days[today];
    if (reading) {
      // قراءة النظر لا تُنجز مهام اليوم
    } else if (taskId === 'new' && day) {
      if (score.accuracy >= s.settings.passMark && score.done === score.total) {
        day.tasks.new.done = true;
        day.tasks.new.accuracy = score.accuracy;
        const ayahs = day.tasks.new.ayahs;
        const set = new Set(s.memorized);
        ayahs.forEach((g) => set.add(g));
        s.memorized = [...set];
        s.portions.push({ date: today, ayahs });
      }
    } else if ((taskId === 'near' || taskId === 'far') && day && score.done === score.total) {
      day.tasks[taskId].done = true;
      day.tasks[taskId].accuracy = score.accuracy;
      if (taskId === 'far') {
        const last = day.tasks.far.ayahs[day.tasks.far.ayahs.length - 1];
        s.farCursor = last + 1 >= totalAyahs() ? 0 : last + 1;
      }
    } else if (taskId === 'weak' && day && score.done === score.total) {
      day.weakDone = true;
    }

    s.sessions.unshift({ date: today, time: Date.now(), taskId, label, ...score });
    s.sessions = s.sessions.slice(0, 300);
  });
}

// ---------- إحصاءات ----------
export function stats() {
  const state = getState();
  const known = memorizedSet(state);
  const days = new Set(state.sessions.map((x) => x.date));
  let streak = 0;
  let d = dayKey();
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { streak++; d = addDays(d, -1); }
  const weakAll = Object.values(state.weak);
  return {
    ayahs: known.size,
    // متوسط أسطر الآيات في الصفحة (بدون أسماء السور والبسملة) ≈ ١٤٫٦
    pages: (linesCount([...known]) * 604) / 8820,
    percent: (known.size / totalAyahs()) * 100,
    streak,
    weakActive: weakAll.filter((w) => !w.mastered).length,
    weakMastered: weakAll.filter((w) => w.mastered).length,
    weakDue: dueWeak(state).length,
  };
}

// ورد أول يوم بإعدادات معينة (للمعاينة في صفحة الخطة)
export function previewChunk(settings) {
  const rem = remainingNew({ ...getState(), settings });
  return takeChunk(rem, settings.unit, settings.amount);
}

// تقدير موعد الختم بالخطة الحالية
export function projection(settings = getState().settings) {
  const state = getState();
  const rem = remainingNew({ ...state, settings });
  // نحاكي الأوراد يوماً بيوم لأن كل ورد يقف عند نهاية آية
  let studyDays = 0;
  for (let i = 0; i < rem.length; studyDays++) i += takeChunk(rem.slice(i, i + 400), settings.unit, settings.amount).length;
  const perWeek = Math.max(1, settings.studyDays.length);
  const calendarDays = Math.ceil((studyDays / perWeek) * 7);
  const last = rem.length ? fromGlobal(rem[rem.length - 1]) : null;
  return { ayahs: rem.length, studyDays, calendarDays, end: addDays(dayKey(), calendarDays), last };
}
