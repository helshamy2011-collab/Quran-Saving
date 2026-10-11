// يبني data/tafsir/<سورة>.json: التفسير الميسر (مجمع الملك فهد) — [[من آية، إلى آية، النص]]
// الميسر يفسر أحياناً عدة آيات معاً، فنجمعها في مجموعة واحدة
// المصدر: github.com/spa5k/tafsir_api (ar-tafsir-muyassar، عن qul.tarteel.ai/resources/tafsir/38)
// حمّل الملفات <dir>/1.json … <dir>/114.json من:
// https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir/ar-tafsir-muyassar/<سورة>.json
// ثم: node tools/build-tafsir.mjs <dir>
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/build-tafsir.mjs <dir>'); process.exit(1); }
const outDir = new URL('../data/tafsir/', import.meta.url);
await mkdir(outDir, { recursive: true });

// المصدر يضيف في أول السورة "تسمية السورة / من مقاصد السورة" وهي ليست من الميسر
function clean(text) {
  let t = text;
  if (t.startsWith('تسمية السورة')) {
    const k = t.indexOf('[التفسير]');
    if (k >= 0) t = t.slice(k);
    else {
      const paras = t.split(/\n\n+/);
      while (paras.length > 1 && (/^(تسمية السورة|من مقاصد السورة)/.test(paras[0]) || paras[0].startsWith('•'))) paras.shift();
      t = paras.join('\n\n');
    }
  }
  return t.replace(/\[التفسير\]/g, '').replace(/\n{2,}/g, '\n').trim();
}

let groups = 0;
for (let s = 1; s <= 114; s++) {
  const list = JSON.parse(await readFile(`${dir}/${s}.json`, 'utf8'));
  const out = [];
  list.forEach((x, i) => {
    if (x.surah !== s || x.ayah !== i + 1) throw new Error(`ترتيب غير متوقع في ${s}:${i + 1}`);
    const t = clean(x.text);
    const last = out.at(-1);
    if (last && last[2] === t) last[1] = x.ayah;
    else out.push([x.ayah, x.ayah, t]);
  });
  groups += out.length;
  await writeFile(new URL(`${String(s).padStart(3, '0')}.json`, outDir), JSON.stringify(out));
}
console.log({ groups });
