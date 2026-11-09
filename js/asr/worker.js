// Web Worker: يشغّل نموذج التعرف على التلاوة بعيد عن الصفحة (ما تهنّجش وانت بتسمّع)
// الرسائل: { type: 'load', model } ← { type: 'ready' } | { type: 'error', message }
//          { type: 'decode', id, audio: Float32Array (16 kHz) } ← { type: 'text', id, text, ms }
import * as ort from '../../vendor/ort/ort.wasm.min.mjs';
import { fbank, ctcGreedy } from './core.js';

ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1; // بدون SharedArrayBuffer (GitHub Pages ما بيسمحش بعزل الأصل)

let session = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      if (!session) session = await ort.InferenceSession.create(msg.model, { executionProviders: ['wasm'] });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }
  if (msg.type === 'decode') {
    const t0 = performance.now();
    try {
      const { data, frames } = fbank(msg.audio);
      if (frames < 10) { self.postMessage({ type: 'text', id: msg.id, text: '', ms: 0 }); return; }
      const out = await session.run({
        x: new ort.Tensor('float32', data, [1, frames, 80]),
        x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
      });
      const lp = out.log_probs;
      self.postMessage({ type: 'text', id: msg.id, text: ctcGreedy(lp.data, lp.dims[1], lp.dims[2]), ms: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err?.message || err) });
    }
  }
};
