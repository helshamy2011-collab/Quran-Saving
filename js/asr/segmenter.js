// تقطيع الصوت لجُمل بالوقفات (بدون DOM: يتجرّب في Node)
// الصوت يدخل 16 kHz على دفعات؛ يطلع أحداث:
//   { type: 'interim', id, audio }  الجملة لحد دلوقتي (تتفك وتتعرض وانت لسه بتقرأ)
//   { type: 'final', id, audio }    الجملة خلصت (وقفة، أو طولها وصل للحد)
const FRAME = 480;              // 30 ms
const PREROLL = 10;             // 300 ms قبل أول كلام (بداية الكلمة الأولى ما تتقصّش)
const END_SILENCE = 20;         // 600 ms سكوت = آخر الجملة
const INTERIM_EVERY = 0.6 * 16000;
const MAX_LEN = 12 * 16000;
const NOISE_WINDOW = 150;       // 4.5 ثانية     // جملة أطول من كده تتقفل عند أهدأ نقطة في آخر 3 ثواني

export class Segmenter {
  constructor() {
    this.id = 0;
    this.pending = new Float32Array(0);
    this.pre = [];        // آخر إطارات قبل الكلام
    this.frames = [];     // إطارات الجملة الحالية
    this.levels = [];     // مستوى الصوت لكل إطار في الجملة
    this.speech = false;  // في الجملة كلام
    this.silence = 0;
    this.sinceDecode = 0;
    this.noise = 0;       // مستوى الضوضاء
    this.recent = [];     // مستوى الصوت في آخر إطارات
  }

  threshold() { return Math.max(this.noise * 3, 0.004); }

  push(samples) {
    const events = [];
    const all = new Float32Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let o = 0;
    for (; o + FRAME <= all.length; o += FRAME) this.frame(all.subarray(o, o + FRAME).slice(), events);
    this.pending = all.slice(o);
    return events;
  }

  frame(f, events) {
    let e = 0;
    for (let i = 0; i < f.length; i++) e += f[i] * f[i];
    const rms = Math.sqrt(e / f.length);
    // الضوضاء = أهدى مستوى في آخر ٤٫٥ ثانية (القراءة فيها دايماً فواصل بين الكلمات والنَفَس، فالكلام
    // نفسه ما يتحسبش ضوضاء، والضوضاء لو زادت أو قلّت في الأوضة البرنامج بيتعلمها لوحده)
    this.recent.push(rms);
    if (this.recent.length > NOISE_WINDOW) this.recent.shift();
    this.noise = Math.min(...this.recent);
    const loud = rms > this.threshold();

    if (!this.speech && !this.frames.length) {
      if (!loud) {
        this.pre.push(f);
        if (this.pre.length > PREROLL) this.pre.shift();
        return;
      }
      this.frames = this.pre;
      this.levels = this.pre.map(() => 0);
      this.pre = [];
    }
    this.frames.push(f);
    this.levels.push(rms);
    this.sinceDecode += f.length;
    if (loud) { this.speech = true; this.silence = 0; } else this.silence++;

    if (this.speech && this.silence >= END_SILENCE) { this.close(this.frames.length, events); return; }
    if (this.frames.length * FRAME >= MAX_LEN) {
      // أهدأ إطار في آخر 3 ثواني (غالباً بين كلمتين)
      const from = Math.max(0, this.frames.length - 100);
      let cut = this.frames.length;
      let min = Infinity;
      for (let i = from; i < this.frames.length - 3; i++) if (this.levels[i] < min) { min = this.levels[i]; cut = i + 1; }
      this.close(cut, events);
      return;
    }
    if (this.speech && this.sinceDecode >= INTERIM_EVERY) {
      this.sinceDecode = 0;
      events.push({ type: 'interim', id: this.id, audio: this.audio(this.frames.length) });
    }
  }

  audio(n) {
    const out = new Float32Array(n * FRAME);
    for (let i = 0; i < n; i++) out.set(this.frames[i], i * FRAME);
    return out;
  }

  close(n, events) {
    events.push({ type: 'final', id: this.id, audio: this.audio(n) });
    this.id++;
    const rest = this.frames.slice(n);
    const restLevels = this.levels.slice(n);
    this.frames = [];
    this.levels = [];
    this.speech = false;
    this.silence = 0;
    this.sinceDecode = 0;
    // الباقي بعد القطع (جملة طويلة) يبدأ الجملة اللي بعدها
    if (rest.some((_, i) => restLevels[i] > this.threshold())) {
      this.frames = rest;
      this.levels = restLevels;
      this.speech = true;
    } else this.pre = rest.slice(-PREROLL);
  }

  // إيقاف الاستماع: الجملة اللي فيها كلام تتقفل
  flush() {
    const events = [];
    if (this.speech && this.frames.length) this.close(this.frames.length, events);
    return events;
  }
}
