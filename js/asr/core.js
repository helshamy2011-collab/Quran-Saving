// أساسيات نموذج التعرف على التلاوة (quran-asr-tiny، رخصة MIT): حساب خصائص الصوت، وتحويل مخرجات النموذج لحروف
// بدون DOM ولا شبكة: نفس الكود يشتغل في المتصفح (Web Worker) وفي الاختبارات (Node)
//
// الخصائص: 80 شريط log-mel على طريقة Kaldi بالظبط زي ما اتدرّب النموذج (features.py في مستودع النموذج):
// نافذة povey طولها 25 ms كل 10 ms، إزالة المتوسط، pre-emphasis 0.97، FFT 512، أشرطة mel من 20 لـ 7600 Hz،
// log بحد أدنى float32 epsilon، بدون dither، والأطراف بالانعكاس (snip_edges = false). الصوت 16 kHz بين -1 و 1

export const SAMPLE_RATE = 16000;
const SHIFT = 160;
const LENGTH = 400;
const FFT = 512;
const BINS = 80;
const EPS = 1.1920928955078125e-7;

const WINDOW = new Float32Array(LENGTH);
for (let i = 0; i < LENGTH; i++) WINDOW[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (LENGTH - 1)), 0.85);

// أشرطة mel: لكل شريط أول خانة تردد ومعاملاتها
const mel = (f) => 1127 * Math.log(1 + f / 700);
const BANKS = (() => {
  const half = FFT / 2;
  const width = SAMPLE_RATE / FFT;
  const lo = mel(20);
  const hi = mel(SAMPLE_RATE / 2 - 400);
  const delta = (hi - lo) / (BINS + 1);
  const out = [];
  for (let b = 0; b < BINS; b++) {
    const left = lo + b * delta;
    const center = lo + (b + 1) * delta;
    const right = lo + (b + 2) * delta;
    let start = -1;
    const w = [];
    for (let i = 0; i < half; i++) {
      const m = mel(width * i);
      if (m > left && m < right) {
        if (start < 0) start = i;
        w.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
      }
    }
    out.push({ start, w: Float32Array.from(w) });
  }
  return out;
})();

// FFT حقيقي بطول 512 (radix-2، مرّة لكل إطار)
const COS = new Float64Array(FFT / 2);
const SIN = new Float64Array(FFT / 2);
for (let i = 0; i < FFT / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / FFT); SIN[i] = -Math.sin((2 * Math.PI * i) / FFT); }
const REV = new Uint16Array(FFT);
for (let i = 0, bits = Math.log2(FFT); i < FFT; i++) {
  let r = 0;
  for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
  REV[i] = r;
}
function powerSpectrum(frame, re, im, power) {
  for (let i = 0; i < FFT; i++) { re[REV[i]] = i < LENGTH ? frame[i] : 0; im[REV[i]] = 0; }
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1;
    const step = FFT / size;
    for (let i = 0; i < FFT; i += size) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const a = i + j;
        const b = a + half;
        const tr = re[b] * COS[k] - im[b] * SIN[k];
        const ti = re[b] * SIN[k] + im[b] * COS[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let i = 0; i < FFT / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
}

export const numFrames = (n) => Math.floor((n + SHIFT / 2) / SHIFT);

// wave: Float32Array بـ 16 kHz ← { data: Float32Array(frames*80), frames }
export function fbank(wave) {
  const n = wave.length;
  const t = numFrames(n);
  const out = new Float32Array(t * BINS);
  const frame = new Float64Array(LENGTH);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const power = new Float64Array(FFT / 2);
  for (let f = 0; f < t; f++) {
    const base = f * SHIFT + SHIFT / 2 - LENGTH / 2;
    let sum = 0;
    for (let i = 0; i < LENGTH; i++) {
      let idx = base + i;
      if (idx < 0) idx = -idx - 1;
      if (idx >= n) idx = 2 * n - 1 - idx;
      idx = Math.min(Math.max(idx, 0), n - 1);
      frame[i] = wave[idx];
      sum += frame[i];
    }
    const mean = sum / LENGTH;
    for (let i = 0; i < LENGTH; i++) frame[i] -= mean;
    for (let i = LENGTH - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1];
    frame[0] *= 1 - 0.97;
    for (let i = 0; i < LENGTH; i++) frame[i] *= WINDOW[i];
    powerSpectrum(frame, re, im, power);
    for (let b = 0; b < BINS; b++) {
      const { start, w } = BANKS[b];
      let e = 0;
      for (let j = 0; j < w.length; j++) e += w[j] * power[start + j];
      out[f * BINS + b] = Math.log(Math.max(e, EPS));
    }
  }
  return { data: out, frames: t };
}

// الحروف اللي بيكتبها النموذج (tokens.txt): 0 فراغ CTC، 1..29 حروف، 30 فاصل كلمات
export const TOKENS = ['', 'ء', 'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي', ' '];

// فك ترميز CTC بالأعلى احتمالاً: logProbs [frames * vocab] ← نص (كلمات بمسافات)
export function ctcGreedy(logProbs, frames, vocab = TOKENS.length) {
  let text = '';
  let prev = -1;
  for (let f = 0; f < frames; f++) {
    let best = 0;
    let bestV = -Infinity;
    for (let v = 0; v < vocab; v++) {
      const x = logProbs[f * vocab + v];
      if (x > bestV) { bestV = x; best = v; }
    }
    if (best !== prev && best !== 0) text += TOKENS[best];
    prev = best;
  }
  return text.replace(/\s+/g, ' ').trim();
}
