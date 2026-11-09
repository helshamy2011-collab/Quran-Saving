// «نموذج القرآن» (تجريبي): سماع التلاوة بنموذج متدرّب على القرآن يشتغل على الجهاز نفسه، بدل التعرف الصوتي بتاع المتصفح
// النموذج: quran-asr-tiny (رخصة MIT، huggingface.co/Abdou/quran-asr-tiny) — 19 ميجا، بيكتب الحروف اللي اتقالت
// بدون ما يخمّن الكلمة (فما بيخبّيش الغلط). نفس واجهة Listener في speech.js: onWords(tokens, isFinal, key, alts)
import { Segmenter } from './segmenter.js';
import { SAMPLE_RATE } from './core.js';

const MODEL_URL = new URL('../../models/quran-asr-tiny/model.int8.onnx', import.meta.url).href;

export const quranAsrSupported = typeof WebAssembly === 'object' && typeof Worker === 'function'
  && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode === 'function';

let worker = null;
let ready = null;
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    ready = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data.type === 'ready') { worker.removeEventListener('message', onMsg); resolve(); }
        if (e.data.type === 'error' && e.data.id == null) { worker.removeEventListener('message', onMsg); reject(new Error(e.data.message)); }
      };
      worker.addEventListener('message', onMsg);
    });
    ready.catch(() => { worker?.terminate(); worker = null; });
    worker.postMessage({ type: 'load', model: MODEL_URL });
  }
  return ready;
}

// تحويل بسيط لـ 16 kHz لو المتصفح ما رضيش يفتح الصوت بيه مباشرة (متوسط كل مجموعة عينات)
function downsample(x, rate) {
  if (rate === SAMPLE_RATE) return x;
  const ratio = rate / SAMPLE_RATE;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

export class QuranListener {
  constructor({ onWords, onState, onError, onStatus }) {
    this.onWords = onWords;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.active = false;
    this.session = 0;
    this.revisesInterim = true; // كل نتيجة مؤقتة قراءة جديدة للجملة كلها (عرض بس في التسميع)
  }

  async start() {
    if (this.active) return;
    this.active = true;
    this.session++;
    const session = this.session;
    this.onState('listening');
    try {
      if (!worker) this.onStatus('بيتحمّل نموذج القرآن… (أول مرة بس، حوالي ٣٠ ميجا)');
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
        getWorker(),
      ]);
      if (!this.active || session !== this.session) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      let ctx;
      try { ctx = new AudioContext({ sampleRate: SAMPLE_RATE }); } catch { ctx = new AudioContext(); }
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(new URL('./capture.js', import.meta.url));
      let src;
      try { src = ctx.createMediaStreamSource(stream); } catch {
        // بعض المتصفحات ما بتوصّلش ميكروفون بسرعة مختلفة: نفتح بالسرعة العادية ونحوّل احنا
        await ctx.close();
        ctx = new AudioContext();
        this.ctx = ctx;
        await ctx.audioWorklet.addModule(new URL('./capture.js', import.meta.url));
        src = ctx.createMediaStreamSource(stream);
      }
      const node = new AudioWorkletNode(ctx, 'quran-capture');
      const seg = new Segmenter();
      this.seg = seg;
      this.queue = [];
      this.busy = false;
      this.finished = new Set();
      node.port.onmessage = (e) => {
        if (!this.active) return;
        for (const ev of seg.push(downsample(e.data, ctx.sampleRate))) this.enqueue(ev, session);
      };
      src.connect(node);
      // لازم يتوصل بالسماعة عشان سفاري يشغّله (من غير صوت: الحجم صفر)
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      this.onStatus('');
    } catch (err) {
      this.active = false;
      this.cleanup();
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      this.onError(denied ? 'لم يُسمح باستخدام الميكروفون. اسمح للموقع بالوصول للميكروفون من إعدادات المتصفح.'
        : `تعذر تشغيل نموذج القرآن: ${err?.message || err}`);
      this.onState('stopped');
    }
  }

  // الجمل الخلصانة تتفك بالترتيب؛ والمؤقتة بس لو المعالج فاضي (آخر نسخة بس)
  enqueue(ev, session) {
    if (ev.type === 'final') {
      this.queue = this.queue.filter((x) => !(x.type === 'interim' && x.id === ev.id));
      this.queue.push(ev);
    } else {
      this.queue = this.queue.filter((x) => !(x.type === 'interim'));
      this.queue.push(ev);
    }
    this.pump(session);
  }

  pump(session) {
    if (this.busy || !this.queue.length || !worker) return;
    const ev = this.queue.shift();
    if (ev.type === 'interim' && this.finished.has(ev.id)) { this.pump(session); return; }
    this.busy = true;
    const reqId = `${session}:${ev.id}:${ev.type}:${Math.random()}`;
    const onMsg = (e) => {
      if (e.data.id !== reqId) return;
      worker.removeEventListener('message', onMsg);
      this.busy = false;
      if (e.data.type === 'text' && session === this.session) {
        const final = ev.type === 'final';
        if (final) this.finished.add(ev.id);
        if (final || !this.finished.has(ev.id)) {
          const tokens = e.data.text.split(' ').filter(Boolean);
          if (tokens.length || final) this.onWords(tokens, final, `${session}:${ev.id}`, [tokens]);
        }
      }
      this.pump(session);
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'decode', id: reqId, audio: ev.audio }, [ev.audio.buffer]);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    // آخر جملة (لو فيها كلام) تتفك قبل ما نقفل
    if (this.seg) for (const ev of this.seg.flush()) this.enqueue(ev, this.session);
    this.cleanup();
    this.onState('stopped');
  }

  cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.seg = null;
  }
}
