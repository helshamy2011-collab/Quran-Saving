// يبني data/gharib/<سورة>.json: معاني الكلمات من «الميسر في غريب القرآن» (مجمع الملك فهد)
// كل عبارة ﴿…﴾ في المصدر تُربط بكلماتها في الآية: { "<آية>": [[أول كلمة، آخر كلمة، العبارة، المعنى]] }
// المصدر: github.com/spa5k/tafsir_api (al-muyassar-fi-al-gharib، عن qul.tarteel.ai/resources/tafsir/519)
// حمّل <dir>/1.json … <dir>/114.json من:
// https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir/al-muyassar-fi-al-gharib/<سورة>.json
// ثم: node tools/build-gharib.mjs <dir>
import { readFile, writeFile, mkdir } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-gharib.mjs <dir>'); process.exit(1); }
const outDir = new URL('../data/gharib/', import.meta.url);
await mkdir(outDir, { recursive: true });

const isWord = (w) => /[ء-يٱ]/.test(w);
// المصدر يكتب أحياناً الألف الصغيرة بعد مسافة وفاصل غير مرئي («ٱلصِّرَ ٰ⁠طَ»)، وتنوين بصيغة أخرى (ࣰ)
const clean = (t) => t.replace(/⁠/g, '').replace(/\s+(?=[ؐ-ًؚ-ٰٟۖ-ۭ])/g, '')
  .replace(/ࣰ/g, 'ً').replace(/ࣱ/g, 'ٌ').replace(/ࣲ/g, 'ٍ').trim();
const norm = (w) => Q.normalizeArabic(w);

// أفضل موضع للعبارة في كلمات الآية (أكثر كلمات متطابقة بالترتيب)، بدءاً من موضع آخر عبارة
function locate(phrase, words, from) {
  const p = phrase.split(/\s+/).filter(isWord).map(norm);
  if (!p.length) return null;
  let best = null;
  for (const start of [from, 0]) {
    for (let i = start; i < words.length; i++) {
      let hit = 0;
      for (let k = 0; k < p.length && i + k < words.length; k++) {
        if (Q.wordMatches(p[k], words[i + k]) || norm(words[i + k].text) === p[k]) hit++;
      }
      const score = hit / p.length;
      if (score > (best?.score ?? 0.5)) best = { i, j: Math.min(words.length, i + p.length) - 1, score };
      if (score === 1) return best;
    }
    if (best) return best;
  }
  return best;
}

let phrases = 0;
let placed = 0;
const misses = [];
for (let s = 1; s <= 114; s++) {
  const list = JSON.parse(await readFile(`${dir}/${s}.json`, 'utf8'));
  const out = {};
  for (const x of list) {
    if (x.surah !== s) throw new Error(`سورة غير متوقعة في ${s}`);
    const g = Q.toGlobal(s, x.ayah);
    const words = Q.ayahWords(g);
    let from = 0;
    for (const m of x.text.matchAll(/﴿([^﴾]+)﴾\s*:?\s*([^\n]+)/g)) {
      phrases++;
      const phrase = clean(m[1]);
      const hit = locate(phrase, words, from);
      if (!hit) { if (misses.length < 10) misses.push(`${s}:${x.ayah} ${m[1]}`); continue; }
      placed++;
      from = hit.j + 1;
      (out[x.ayah] ||= []).push([hit.i, hit.j, phrase, m[2].trim()]);
    }
  }
  await writeFile(new URL(`${String(s).padStart(3, '0')}.json`, outDir), JSON.stringify(out));
}
console.log({ phrases, placed, missed: phrases - placed, examples: misses });
