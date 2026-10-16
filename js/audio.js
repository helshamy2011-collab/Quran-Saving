// تشغيل صوت الكلمات والآيات
// صوت الكلمة الواحدة من quran.com (كلمة كلمة)، ولو تعذّر نرجع لصوت الآية كاملة من everyayah

import { fromGlobal } from './quran.js';

const pad = (n) => String(n).padStart(3, '0');

// k: رقم الكلمة في الآية من 0
export function wordUrl(g, k) {
  const { s, a } = fromGlobal(g);
  return `https://audio.qurancdn.com/wbw/${pad(s)}_${pad(a)}_${pad(k + 1)}.mp3`;
}

export function ayahUrl(g, reciter) {
  const { s, a } = fromGlobal(g);
  return `https://everyayah.com/data/${reciter}/${pad(s)}${pad(a)}.mp3`;
}

// قائمة تشغيل: كل عنصر { urls: [الأساسي، البديل…], onStart }
// تُرجع Promise تنتهي بعد آخر عنصر أو عند stop()
export class Player {
  constructor() { this.el = null; this.token = 0; }

  get playing() { return !!this.el; }

  stop() {
    this.token++;
    if (this.el) { this.el.pause(); this.el = null; }
    this.done?.();
    this.done = null;
  }

  play(items) {
    this.stop();
    const token = this.token;
    return new Promise((resolve) => {
      this.done = resolve;
      const next = (i) => {
        if (token !== this.token) return;
        if (i >= items.length) { this.el = null; this.done = null; resolve(); return; }
        items[i].onStart?.();
        tryUrl(i, 0);
      };
      const tryUrl = (i, u) => {
        const url = items[i].urls[u];
        if (!url) { next(i + 1); return; }
        const el = new Audio(url);
        this.el = el;
        // الخطأ قد يصل مرتين (onerror ورفض play) فننتقل للبديل مرة واحدة
        let failed = false;
        const fail = () => {
          if (failed || token !== this.token || this.el !== el) return;
          failed = true;
          tryUrl(i, u + 1);
        };
        el.onended = () => { if (token === this.token && this.el === el) next(i + 1); };
        el.onerror = fail;
        el.play().catch(fail);
      };
      next(0);
    });
  }
}
