// خطة الحفظ: الحفظ الجديد + المراجعة القريبة + المراجعة البعيدة + نقاط الضعف

import { getState, update, dayKey, addDays } from './store.js';
import { toGlobal, ayahCount, ayahWordCount, totalAyahs, fromGlobal, toArabicDigits } from './quran.js';
import { STATUS, isMistake } from './matcher.js';

// متوسط مصحف المدينة: ٦٠٤ صفحة، ١٥ سطراً، ≈ ٧٧٤٠٠ كلمة
export const WORDS_PER_LINE = 8.5;
export const WORDS_PER_PAGE = 128;
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

function budgetWords(unit, amount) {
  if (unit === 'line') return amount * WORDS_PER_LINE;
  if (unit === 'page') return amount * WORDS_PER_PAGE;
  return Infinity;
}

// يأخذ آيات من القائمة حتى يكتمل المقدار المطلوب
function takeChunk(list, unit, amount) {
  if (unit === 'ayah') return list.slice(0, Math.max(1, Math.round(amount)));
  const budget = budgetWords(unit, amount);
  const out = [];
  let words = 0;
  for (const g of list) {
    const w = ayahWordCount(g);
    // لا نقطع إذا تجاوزنا المقدار بكثير، إلا لو كانت أول آية
    if (out.length && words + w > budget * 1.25) break;
    out.push(g);
    words += w;
    if (words >= budget) break;
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
      { id: 'weak', title: 'نقاط الضعف', icon: '🎯', desc: 'الكلمات التي أخطأت فيها أو نسيتها وحان وقت مراجعتها', ayahs: weakAyahs(weak), done: !weak.length && day.weakDone, count: weak.length },
      { id: 'new', title: 'الحفظ الجديد', icon: '🌱', desc: 'احفظ الورد ثم سمّعه', ...day.tasks.new },
      { id: 'near', title: 'المراجعة القريبة', icon: '🔁', desc: `ما حفظته في آخر ${toArabicDigits(getState().settings.nearDays)} أيام`, ...day.tasks.near },
      { id: 'far', title: 'المراجعة البعيدة', icon: '📖', desc: 'دورة على كل محفوظك القديم', ...day.tasks.far },
    ],
  };
}

// ---------- تسجيل نتيجة جلسة تسميع ----------
// words: [{g, w}] — status: حالة كل كلمة من المحرك
export function recordSession({ taskId, label, words, status, score }) {
  const today = dayKey();
  update((s) => {
    // تحديث نقاط الضعف
    words.forEach((word, i) => {
      const st = status[i];
      if (st === STATUS.HIDDEN) return;
      const key = `${word.g}:${word.w}`;
      const item = s.weak[key];
      if (isMistake(st)) {
        const it = item || { g: word.g, w: word.w, misses: 0, hits: 0, history: [] };
        it.misses++;
        it.box = 0;
        it.mastered = false;
        it.kind = st;
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

    const day = s.days[today];
    if (taskId === 'new' && day) {
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
  const words = [...known].reduce((n, g) => n + ayahWordCount(g), 0);
  const days = new Set(state.sessions.map((x) => x.date));
  let streak = 0;
  let d = dayKey();
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { streak++; d = addDays(d, -1); }
  const weakAll = Object.values(state.weak);
  return {
    ayahs: known.size,
    pages: words / WORDS_PER_PAGE,
    percent: (known.size / totalAyahs()) * 100,
    streak,
    weakActive: weakAll.filter((w) => !w.mastered).length,
    weakMastered: weakAll.filter((w) => w.mastered).length,
    weakDue: dueWeak(state).length,
  };
}

// تقدير موعد الختم بالخطة الحالية
export function projection(settings = getState().settings) {
  const state = getState();
  const rem = remainingNew({ ...state, settings });
  const words = rem.reduce((n, g) => n + ayahWordCount(g), 0);
  const perDay = settings.unit === 'ayah'
    ? settings.amount * (words / Math.max(1, rem.length))
    : budgetWords(settings.unit, settings.amount);
  const studyDays = Math.ceil(words / Math.max(1, perDay));
  const perWeek = Math.max(1, settings.studyDays.length);
  const calendarDays = Math.ceil((studyDays / perWeek) * 7);
  const last = rem.length ? fromGlobal(rem[rem.length - 1]) : null;
  return { ayahs: rem.length, studyDays, calendarDays, end: addDays(dayKey(), calendarDays), last };
}
