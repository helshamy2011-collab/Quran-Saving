// يبني data/similar.json: الآيات المتشابهة لفظياً (المتشابهات) — تشغيل: node tools/build-similar.mjs
import { readFile, writeFile } from 'node:fs/promises';

globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) });
const Q = await import('../js/quran.js');
await Q.loadQuran();

const N = Q.totalAyahs();
const W = [];
for (let g = 0; g < N; g++) W.push(Q.ayahWords(g).map((w) => w.forms[0]));

// فهرس الكلمتين المتتاليتين → الآيات
const index = new Map();
W.forEach((ws, g) => {
  const seen = new Set();
  for (let i = 0; i + 1 < ws.length; i++) {
    const k = ws[i] + ' ' + ws[i + 1];
    if (seen.has(k)) continue;
    seen.add(k);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(g);
  }
});

function wordLev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

const out = {};
let pairs = 0;
for (let g = 0; g < N; g++) {
  const a = W[g];
  if (a.length < 3) continue;
  const counts = new Map();
  const seen = new Set();
  for (let i = 0; i + 1 < a.length; i++) {
    const k = a[i] + ' ' + a[i + 1];
    if (seen.has(k)) continue;
    seen.add(k);
    const post = index.get(k);
    if (post.length > 400) continue; // عبارات شائعة جداً لا تميّز
    for (const h of post) if (h !== g) counts.set(h, (counts.get(h) || 0) + 1);
  }
  const found = [];
  for (const [h, c] of counts) {
    const b = W[h];
    if (b.length < 3 || c < 2) continue;
    if (c < 0.3 * (Math.min(a.length, b.length) - 1)) continue;
    const lev = 1 - wordLev(a, b) / Math.max(a.length, b.length);
    // الكلمات المشتركة بنفس الترتيب (تلتقط الآيات الطويلة المختلفة في مواضع متفرقة)
    const dice = (2 * lcs(a, b)) / (a.length + b.length);
    const sim = Math.max(lev, dice);
    if (sim >= 0.6) found.push([h, Math.round(sim * 100)]);
  }
  found.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  if (found.length) { out[g] = found.slice(0, 6); pairs += found.length; }
}
await writeFile(new URL('../data/similar.json', import.meta.url), JSON.stringify({
  source: 'computed by tools/build-similar.mjs: word-level similarity >= 60% between ayat',
  similar: out,
}));
console.log('ayat with similars:', Object.keys(out).length, 'pairs:', pairs);
