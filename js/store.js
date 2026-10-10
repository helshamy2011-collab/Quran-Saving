// حفظ البيانات محلياً على الجهاز (localStorage)

const KEY = 'quran-hifz-v1';

export const DEFAULT_SETTINGS = {
  startSurah: 1,
  direction: 'forward',   // forward: من الفاتحة للناس — backward: من الناس للفاتحة
  unit: 'line',           // ayah | line | page
  amount: 5,              // مقدار الحفظ الجديد يومياً
  farUnit: 'page',
  farAmount: 2,           // مقدار المراجعة البعيدة يومياً
  nearDays: 7,            // المراجعة القريبة = ما حفظته في آخر كذا يوم
  passMark: 90,           // نسبة الإتقان المطلوبة لاعتماد الحفظ الجديد
  studyDays: [0, 1, 2, 3, 4, 6], // أيام الحفظ الجديد (0 = الأحد) — الجمعة مراجعة فقط
  prior: [],              // سور محفوظة من قبل (تدخل في المراجعة)
  lang: 'ar-SA',
  warnWeak: true,         // تمييز مواضع الأخطاء السابقة أثناء التسميع
  reminderTime: '20:00',
  reminders: false,
  reciter: 'Husary_128kbps',
};

function fresh() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    setupDone: false,
    memorized: [],      // فهارس الآيات التي حُفظت ضمن الخطة
    portions: [],       // [{ date, ayahs: [g] }]
    farCursor: 0,
    days: {},           // خطة كل يوم وحالة مهامها
    weak: {},           // 'g:w' → نقطة ضعف
    sessions: [],
    lastReminder: '',
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    const base = fresh();
    return { ...base, ...s, settings: { ...base.settings, ...s.settings } };
  } catch {
    return fresh();
  }
}

export function getState() { return state; }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.error(e); }
}

export function update(fn) { fn(state); save(); }

export function exportData() { return JSON.stringify(state, null, 1); }

export function importData(json) {
  const s = JSON.parse(json);
  if (!s || typeof s !== 'object' || !s.settings) throw new Error('ملف غير صالح');
  state = { ...fresh(), ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
  save();
}

export function resetAll() { state = fresh(); save(); }

// ---------- التاريخ ----------
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

export function formatDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
}
