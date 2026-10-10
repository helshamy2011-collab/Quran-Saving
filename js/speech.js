// غلاف حول Web Speech API مع إعادة تشغيل تلقائية
// (المتصفح يوقف الاستماع بعد فترة صمت، فنعيد تشغيله طالما المستخدم لم يضغط إيقاف)

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;
const isAndroid = /Android/i.test(navigator.userAgent);

export class Listener {
  // onWords(tokens, isFinal, resultKey, alternatives)
  constructor({ lang = 'ar-SA', onWords, onState, onError }) {
    this.lang = lang;
    this.onWords = onWords;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.active = false;
    this.rec = null;
    this.session = 0;
  }

  start() {
    if (!SR || this.active) return;
    this.active = true;
    this.launch();
  }

  stop() {
    this.active = false;
    if (this.rec) { try { this.rec.stop(); } catch { /* ignore */ } }
    this.onState('stopped');
  }

  launch() {
    const rec = new SR();
    this.rec = rec;
    this.session++;
    const session = this.session;
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    // على أندرويد الوضع المستمر يكرر النص المتراكم، فنستخدم جملاً منفصلة
    rec.continuous = !isAndroid;

    rec.onstart = () => this.onState('listening');
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = [];
        for (let k = 0; k < r.length; k++) alts.push(r[k].transcript.trim().split(/\s+/).filter(Boolean));
        this.onWords(alts[0], r.isFinal, `${session}:${i}`, alts);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false;
        this.onError('لم يُسمح باستخدام الميكروفون. اسمح للموقع بالوصول للميكروفون من إعدادات المتصفح.');
        return;
      }
      if (e.error === 'network') {
        this.onError('التعرف على الصوت يحتاج اتصالاً بالإنترنت في هذا المتصفح.');
        return;
      }
      this.onError(`خطأ في التعرف على الصوت: ${e.error}`);
    };
    rec.onend = () => {
      if (this.active && this.rec === rec) {
        setTimeout(() => { if (this.active) this.launch(); }, 150);
      } else {
        this.onState('stopped');
      }
    };
    try { rec.start(); } catch (err) { this.onError(String(err)); }
  }
}
