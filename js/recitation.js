// وحدة التسميع: تعرض الآيات (مخفية كلها أو بعضها أو ظاهرة) وتتابع القراءة بالصوت
// تستخدمها شاشة التسميع ووضع «حفّظني» وقراءة النظر

import { ayahWords, fromGlobal, surahName, toArabicDigits as ar } from './quran.js';
import { Matcher, STATUS, isMistake } from './matcher.js';
import { Listener, speechSupported } from './speech.js';
import { icon } from './icons.js';

export const STATUS_LABEL = {
  [STATUS.WRONG]: 'خطأ',
  [STATUS.SKIPPED]: 'أسقطها',
  [STATUS.HINT]: 'نسيها',
  [STATUS.CORRECTED]: 'تردد',
  [STATUS.UNSURE]: 'ما اتسمعتش بوضوح',
};

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function wordsOf(ayahs) {
  const words = [];
  for (const g of ayahs) ayahWords(g).forEach((w, i) => words.push({ ...w, g, w: i }));
  return words;
}

export class Recitation {
  /**
   * mushafEl: حاوية النص — dockEl: حاوية شريط التحكم
   * onUpdate(score) بعد كل تغيير — onComplete() عند آخر كلمة — onFinishRequest() زر الإنهاء
   */
  constructor({ mushafEl, dockEl, lang, weak = {}, warnWeak = true, onUpdate, onComplete, onFinishRequest, onError, finishLabel = 'إنهاء التسميع' }) {
    Object.assign(this, { mushafEl, dockEl, weak, warnWeak, onUpdate, onComplete, onFinishRequest, onError });
    this.manual = !speechSupported;
    this.active = true;
    this.completed = false;
    this.paused = false;

    dockEl.innerHTML = `<div class="inner">
      ${this.manual
        ? `<button type="button" class="btn primary big" data-r="ok">${icon('check')}قلتها صح</button>`
        : `<button type="button" class="mic" data-r="mic" aria-label="ابدأ الاستماع" aria-pressed="false">${icon('mic', { size: 28 })}</button>`}
      <p class="heard" aria-live="off">${this.manual ? 'مسافة = صح · H = نسيتها · Z = تراجع' : 'اضغط على الميكروفون وابدأ القراءة…'}</p>
      <div class="dock-actions">
        <button type="button" class="btn" data-r="hint">${icon('bulb', { size: 18 })}نسيتها</button>
        <button type="button" class="btn icon-only" data-r="undo" aria-label="تراجع عن آخر كلمة">${icon('undo', { size: 18 })}</button>
        <button type="button" class="btn icon-only" data-r="finish" aria-label="${finishLabel}">${icon('flag', { size: 18 })}</button>
      </div>
    </div>`;
    this.micBtn = dockEl.querySelector('[data-r=mic]');
    this.hintBtn = dockEl.querySelector('[data-r=hint]');
    this.heardEl = dockEl.querySelector('.heard');

    dockEl.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const act = b.dataset.r;
      if (act === 'mic') this.toggleMic();
      if (act === 'hint') this.hint();
      if (act === 'ok') this.ok();
      if (act === 'undo') this.undo();
      if (act === 'finish') this.finishRequest();
    };
    mushafEl.onclick = (e) => {
      const w = e.target.closest('.w');
      if (!w || !this.matcher || this.completed) return;
      const i = Number(w.dataset.i);
      if (i < this.matcher.pos) { this.matcher.snapshot(); this.matcher.toggle(i); this.prevStatus[i] = null; this.paint(); }
    };

    this.onKey = (e) => {
      if (!this.active || this.completed || e.target.matches('input, select, textarea')) return;
      if (e.code === 'Space' && !e.target.matches('button')) { e.preventDefault(); if (this.manual) this.ok(); else this.toggleMic(); }
      if (e.key === 'h' || e.key === 'H' || e.key === 'ا') this.hint();
      if (e.key === 'z' || e.key === 'Z' || e.key === 'ئ') this.undo();
    };
    document.addEventListener('keydown', this.onKey);

    this.consumed = new Map();
    this.log = [];          // كل ما سمعه البرنامج (لعرضه في النتيجة ولتشخيص المشاكل)
    this.lastSession = null;
    this.listener = this.manual ? null : new Listener({
      lang,
      onWords: (tokens, isFinal, key, alts) => this.onWords(tokens, isFinal, key, alts),
      onState: () => this.syncMic(),
      onError: (msg) => { this.heardEl.textContent = msg; this.onError?.(msg); this.syncMic(); },
    });

    // تنبيه لو توقف طويلاً
    this.stallTimer = setInterval(() => {
      if (this.completed || this.paused || !this.listener?.active) return;
      if (Date.now() - this.lastProgress > 7000) {
        this.hintBtn.classList.add('nudge');
        this.heardEl.textContent = 'توقفت؟ لو نسيت الكلمة اضغط «نسيتها» وسأكشفها لك.';
      }
    }, 1000);
  }

  // تحميل مقطع جديد (الاستماع يستمر لو كان شغالاً)
  // visible(i, word): هل الكلمة ظاهرة قبل قراءتها؟
  load({ ayahs, visible = () => false, reading = false }) {
    this.ayahs = ayahs;
    this.words = wordsOf(ayahs);
    this.matcher = new Matcher(this.words);
    this.visible = this.words.map((w, i) => visible(i, w));
    this.completed = false;
    this.consumed.clear();
    this.lastProgress = Date.now();
    this.mushafEl.classList.toggle('reading', reading);

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
        const wk = this.weak[`${g}:${i}`];
        const mark = this.warnWeak && wk && !wk.mastered ? ' weak-mark' : '';
        const shown = this.visible[idx];
        html += `<span class="w ${shown ? 'shown' : 'hidden'}${mark}" data-i="${idx}"${shown ? '' : ' aria-hidden="true"'}>${this.words[idx].text}</span> `;
      }
      html += `<span class="ayah-end">﴿${ar(a)}﴾</span> `;
    }
    this.mushafEl.innerHTML = html;
    this.spans = [...this.mushafEl.querySelectorAll('.w')];
    this.prevStatus = this.matcher.status.map(() => null);
    this.paint();
  }

  get score() { return this.matcher.score(); }
  get status() { return this.matcher.status; }

  paint() {
    const m = this.matcher;
    m.status.forEach((stt, i) => {
      if (stt === this.prevStatus[i] && !(i === m.pos || i === m.pos - 1)) return;
      const el = this.spans[i];
      const weakMark = el.classList.contains('weak-mark');
      const base = stt === STATUS.HIDDEN ? (this.visible[i] ? 'shown' : 'hidden') : stt;
      el.className = `w ${base}${weakMark ? ' weak-mark' : ''}`;
      if (stt !== STATUS.HIDDEN) el.classList.add('revealed');
      el.toggleAttribute('aria-hidden', base === 'hidden');
      if (STATUS_LABEL[stt]) el.title = `${STATUS_LABEL[stt]} — اضغط للتصحيح`; else el.removeAttribute('title');
      if (this.prevStatus[i] !== null && stt !== this.prevStatus[i] && stt !== STATUS.HIDDEN) el.classList.add('just');
    });
    if (!m.done) {
      const cur = this.spans[m.pos];
      cur.classList.add('current');
      const r = cur.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 160 || r.top < 120) cur.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    if (m.status.some((x, i) => x !== this.prevStatus[i])) this.lastProgress = Date.now();
    this.prevStatus = m.status.slice();
    this.hintBtn.classList.remove('nudge');
    this.onUpdate?.(m.score());
    if (m.done && !this.completed) {
      this.completed = true;
      this.onComplete?.();
    }
  }

  onWords(tokens, isFinal, key, alts) {
    if (this.completed || this.paused || !this.matcher) return;
    this.heardEl.textContent = `سمعت: ${tokens.join(' ')}`;
    const m = this.matcher;
    // الميكروفون أعاد التشغيل (بعد وقفة): قد تكون كلمة ضاعت في الفجوة
    const session = key.split(':')[0];
    if (this.lastSession !== null && session !== this.lastSession) m.afterGap = true;
    this.lastSession = session;
    const used = this.consumed.get(key) || 0;
    if (!isFinal) {
      this.lastInterim = { key, tokens };
      const n = m.feedInterim(tokens.slice(used));
      if (n) { this.consumed.set(key, used + n); this.paint(); }
      return;
    }
    if (this.lastInterim?.key === key) this.lastInterim = null;
    // نختار من بدائل التعرف الأقرب للنص
    let best = alts[0];
    let bestScore = -Infinity;
    for (const alt of alts) {
      const c = m.clone();
      c.feedFinal(alt.slice(used));
      let sc = 0;
      c.status.forEach((x, i) => { if (x !== m.status[i]) sc += isMistake(x) ? -2 : 1; });
      if (sc > bestScore) { bestScore = sc; best = alt; }
    }
    m.snapshot();
    this.log.push(best.join(' '));
    m.feedFinal(best.slice(used));
    this.consumed.delete(key);
    this.paint();
  }

  // زر الإنهاء: آخر كلمات قد تكون قيلت ولم تصل كنتيجة نهائية من التعرف الصوتي
  finishRequest() {
    const m = this.matcher;
    if (!m || this.completed) return;
    if (this.lastInterim) {
      const { key, tokens } = this.lastInterim;
      this.lastInterim = null;
      m.snapshot();
      m.feedFinal(tokens.slice(this.consumed.get(key) || 0));
      this.log.push(`${tokens.join(' ')} (غير مكتملة)`);
    }
    if (!m.done) m.finishTail(2);
    this.paint();
    if (!this.completed) this.onFinishRequest?.();
  }

  syncMic() {
    if (!this.micBtn) return;
    const on = !!this.listener?.active;
    this.micBtn.classList.toggle('on', on);
    this.micBtn.setAttribute('aria-pressed', String(on));
    this.micBtn.setAttribute('aria-label', on ? 'أوقف الاستماع' : 'ابدأ الاستماع');
    this.micBtn.innerHTML = icon(on ? 'pause' : 'mic', { size: 28 });
  }

  toggleMic() {
    if (!this.listener) return;
    if (this.listener.active) this.listener.stop();
    else { this.listener.start(); this.lastProgress = Date.now(); }
    this.syncMic();
  }

  get listening() { return !!this.listener?.active; }

  // إيقاف مؤقت (أثناء تشغيل صوت القارئ حتى لا يسمع الميكروفون السماعة)
  pause() {
    this.paused = true;
    this.resumeAfter = this.listening;
    if (this.listening) this.listener.stop();
    this.syncMic();
  }

  resume() {
    this.paused = false;
    if (this.resumeAfter && this.listener && !this.listener.active) { this.listener.start(); this.lastProgress = Date.now(); }
    this.resumeAfter = false;
    this.syncMic();
  }

  hint() { if (this.completed) return; this.matcher.snapshot(); this.matcher.hint(); this.paint(); }
  ok() { if (this.completed) return; this.matcher.snapshot(); this.matcher.revealOk(); this.paint(); }
  undo() {
    if (!this.matcher.undo()) return;
    this.completed = false;
    this.prevStatus = this.prevStatus.map(() => null);
    this.paint();
  }

  setDockHidden(hidden) { this.dockEl.hidden = hidden; }

  destroy() {
    this.active = false;
    this.completed = true;
    this.listener?.stop();
    clearInterval(this.stallTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}
