// اختبارات «نموذج القرآن»: خصائص الصوت، وفك CTC، وتقطيع الصوت بالوقفات — تشغيل: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fbank, numFrames, ctcGreedy, TOKENS } from '../js/asr/core.js';
import { Segmenter } from '../js/asr/segmenter.js';

const SR = 16000;
const tone = (sec, amp = 0.2, f = 220) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const silence = (sec) => new Float32Array(Math.round(sec * SR)).map(() => (Math.random() - 0.5) * 0.002);
const join = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

test('خصائص الصوت: ٨٠ شريط لكل ١٠ ms، والطاقة في الشريط الصح', () => {
  const w = tone(1, 0.3, 1000);
  const { data, frames } = fbank(w);
  assert.equal(frames, numFrames(w.length));
  assert.equal(frames, 100);
  assert.equal(data.length, frames * 80);
  assert.ok(data.every(Number.isFinite));
  // نغمة ١٠٠٠ هرتز: أعلى شريط في النص الأول من الأشرطة (مش في الأطراف)
  const mid = data.subarray(50 * 80, 51 * 80);
  const peak = mid.indexOf(Math.max(...mid));
  assert.ok(peak > 15 && peak < 35, `peak ${peak}`);
});

test('فك CTC: تكرار الحرف من غير فاصل = حرف واحد، والفراغ بيفصل الحروف المتكررة', () => {
  const V = TOKENS.length;
  const frames = (ids) => { const lp = new Float32Array(ids.length * V).fill(-10); ids.forEach((id, f) => { lp[f * V + id] = 0; }); return lp; };
  const id = (ch) => TOKENS.indexOf(ch);
  // «الله»: ل ل محتاجة فراغ CTC بينهم
  const seq = [id('ا'), id('ل'), id('ل'), 0, id('ل'), id('ه'), id(' '), id('ا'), id('ح'), id('د')];
  assert.equal(ctcGreedy(frames(seq), seq.length), 'الله احد');
});

test('تقطيع الصوت: جملة بين وقفتين = نتيجة نهائية واحدة، ومؤقتة وهي لسه بتتقال', () => {
  const s = new Segmenter();
  const ev = s.push(join(silence(1), tone(2), silence(1)));
  const finals = ev.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1);
  assert.ok(ev.some((e) => e.type === 'interim'));
  // الجملة فيها الكلام كله وشوية قبله (أول الكلمة ما يتقصّش)
  assert.ok(finals[0].audio.length >= 2 * SR && finals[0].audio.length < 3 * SR);
});

test('تقطيع الصوت: كلام طويل من غير وقفة يتقسم، ومفيش صوت بيضيع', () => {
  const s = new Segmenter();
  // قراءة متصلة: كلمات (٤٠٠ ms) بفواصل صغيرة بينها (٨٠ ms) زي القراءة الحقيقية، ٣٩ ثانية من غير وقفة
  const words = []; for (let i = 0; i < 81; i++) words.push(tone(0.4), silence(0.08));
  const ev = [...s.push(join(silence(0.5), ...words)), ...s.flush()];
  const finals = ev.filter((e) => e.type === 'final');
  assert.ok(finals.length >= 3, `finals ${finals.length}`);
  assert.ok(finals.every((f) => f.audio.length <= 12 * SR));
  const total = finals.reduce((a, f) => a + f.audio.length, 0);
  assert.ok(total >= 38 * SR, `total ${total / SR}s`);
});

test('ملف النموذج هو نفسه بدون تعديل', async () => {
  const buf = await readFile(new URL('../models/quran-asr-tiny/model.int8.onnx', import.meta.url));
  assert.equal(createHash('sha256').update(buf).digest('hex'), '58de6db034bb4f6516b3bc1c68e7a0ac4e77abffe603a550ee87b39dcd0c7ac6');
});
