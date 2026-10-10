// حفظ البيانات محلياً على الجهاز (localStorage) — لكل شخص بياناته

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
    readIssues: {},     // 'g:w' → كلمات صعبة حتى في القراءة بالنظر
    sessions: [],
    lastReminder: '',
  };
}

// ---------- الأشخاص ----------
// كل شخص له بياناته كاملة (الخطة والتقدم ونقاط الضعف) في مفتاح مستقل.
// أول شخص يستخدم المفتاح القديم حتى لا تضيع بيانات من استخدم البرنامج قبل إضافة الأشخاص.
const PROFILES_KEY = 'quran-hifz-profiles';
const FIRST_ID = 'p1';
export const PROFILE_COLORS = ['#0d5a4b', '#8a5a08', '#5d34a3', '#b42d20', '#1f5fa8', '#7a4b2a'];

const dataKey = (id) => (id === FIRST_ID ? KEY : `${KEY}:${id}`);

function readJSON(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error(e); }
}

function loadProfiles() {
  const p = readJSON(PROFILES_KEY);
  if (p && Array.isArray(p.list) && p.list.length) return p;
  return { active: FIRST_ID, list: [{ id: FIRST_ID, name: 'أنا', color: PROFILE_COLORS[0] }] };
}

let profiles = loadProfiles();
if (!profiles.list.some((x) => x.id === profiles.active)) profiles.active = profiles.list[0].id;

function normalize(s) {
  const base = fresh();
  return { ...base, ...s, settings: { ...base.settings, ...(s?.settings || {}) } };
}

function load(id = profiles.active) {
  const s = readJSON(dataKey(id));
  return s ? normalize(s) : fresh();
}

let state = load();

export function getProfiles() { return profiles; }
export function activeProfile() { return profiles.list.find((x) => x.id === profiles.active); }

export function switchProfile(id) {
  if (!profiles.list.some((x) => x.id === id)) return;
  save();
  profiles.active = id;
  writeJSON(PROFILES_KEY, profiles);
  state = load(id);
}

export function addProfile(name) {
  const id = `p${Date.now().toString(36)}`;
  const color = PROFILE_COLORS[profiles.list.length % PROFILE_COLORS.length];
  profiles.list.push({ id, name: name.trim() || `شخص ${profiles.list.length + 1}`, color });
  writeJSON(PROFILES_KEY, profiles);
  return id;
}

export function renameProfile(id, name) {
  const p = profiles.list.find((x) => x.id === id);
  if (!p || !name.trim()) return;
  p.name = name.trim();
  writeJSON(PROFILES_KEY, profiles);
}

export function deleteProfile(id) {
  if (profiles.list.length <= 1) return;
  profiles.list = profiles.list.filter((x) => x.id !== id);
  try { localStorage.removeItem(dataKey(id)); } catch { /* ignore */ }
  if (profiles.active === id) {
    profiles.active = profiles.list[0].id;
    state = load(profiles.active);
  }
  writeJSON(PROFILES_KEY, profiles);
}

// بيانات شخص آخر للعرض فقط (مثلاً إحصاءات في قائمة الأشخاص)
export function peekProfile(id) { return id === profiles.active ? state : load(id); }

export function getState() { return state; }

export function save() { writeJSON(dataKey(profiles.active), state); }

export function update(fn) { fn(state); save(); }

// ---------- ملف الحفظ (نسخة احتياطية) ----------
// ملف واحد فيه كل الأشخاص، يُنقل لموبايل آخر أو يُحفظ احتياطياً
export function exportData() {
  save();
  return JSON.stringify({
    app: 'rafiq-al-hifz',
    version: 2,
    exported: new Date().toISOString(),
    profiles: profiles.list.map((p) => ({ name: p.name, color: p.color, data: peekProfile(p.id) })),
  });
}

// يقبل ملف كل الأشخاص، أو ملف شخص واحد من النسخة القديمة.
// الأشخاص بنفس الاسم تُستبدل بياناتهم، والأسماء الجديدة تُضاف.
export function importData(json) {
  const obj = JSON.parse(json);
  const entries = Array.isArray(obj?.profiles)
    ? obj.profiles.filter((p) => p && p.data && p.data.settings)
    : obj && obj.settings ? [{ name: activeProfile().name, data: obj }] : [];
  if (!entries.length) throw new Error('الملف ليس ملف حفظ من رفيق الحفظ');
  save();
  let added = 0;
  let replaced = 0;
  for (const e of entries) {
    let p = profiles.list.find((x) => x.name === e.name);
    if (p) replaced++;
    else { const id = addProfile(e.name || 'شخص'); p = profiles.list.find((x) => x.id === id); if (e.color) p.color = e.color; added++; }
    writeJSON(dataKey(p.id), normalize(e.data));
  }
  writeJSON(PROFILES_KEY, profiles);
  state = load(profiles.active);
  return { added, replaced };
}

// يمسح بيانات الشخص الحالي فقط
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
