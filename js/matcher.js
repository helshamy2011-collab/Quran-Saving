// محرك المطابقة: يقارن الكلمات المسموعة بنص المصحف كلمة كلمة
// ويحدد: صحيح / خطأ / سقط (تخطّاه) / نسيه (طلب تلميح) / تردد ثم صحّح

import { normalizeArabic, wordMatches, wordScore, joinedWord, rivalsOf } from './quran.js';

export const STATUS = {
  HIDDEN: 'hidden',
  OK: 'ok',
  CORRECTED: 'corrected', // تلعثم أو قال كلمة خطأ ثم صحّح نفسه
  WRONG: 'wrong',         // قال كلمة أخرى مكانها
  SKIPPED: 'skipped',     // أسقطها وأكمل بعدها
  HINT: 'hint',           // نسيها وطلب تلميحاً
  UNSURE: 'unsure',       // لم تُسمع بوضوح (كلمة قصيرة أسقطها التعرف الصوتي، أو ضاعت أثناء إعادة تشغيل الميكروفون) — لا تُحسب خطأ
};

export const isMistake = (st) => st === STATUS.WRONG || st === STATUS.SKIPPED || st === STATUS.HINT || st === STATUS.CORRECTED;

export class Matcher {
  // words: [{ g, w, text, forms }]
  constructor(words) {
    this.words = words;
    // بداية كل مقطع (أول كلمة، أو آية غير متصلة بما قبلها)
    this.starts = words.map((w, i) => i === 0 || (w.g !== words[i - 1].g && w.g !== words[i - 1].g + 1));
    this.status = words.map(() => STATUS.HIDDEN);
    this.heardAt = words.map(() => ''); // ما قاله المستخدم مكان الكلمة الخطأ (لكشف الخلط بالمتشابهات)
    // الكلمات المقابلة في الآيات المتشابهة (لو قالها المستخدم فهو خلط وليس نطقاً مختلفاً)
    this.rivals = words.map((w) => (w.g != null ? rivalsOf(w.g)[w.w] || [] : []));
    this.pos = 0;
    this.missStreak = 0;
    this.missHeard = [];
    this.afterGap = false; // الميكروفون أعاد التشغيل للتو (بعد وقفة) فقد تضيع كلمة
    this.history = [];
  }

  get done() { return this.pos >= this.words.length; }

  clone() {
    const m = new Matcher(this.words);
    m.status = this.status.slice();
    m.heardAt = this.heardAt.slice();
    m.pos = this.pos;
    m.missStreak = this.missStreak;
    m.missHeard = this.missHeard.slice();
    return m;
  }

  snapshot() {
    this.history.push({ status: this.status.slice(), heardAt: this.heardAt.slice(), pos: this.pos, missStreak: this.missStreak, missHeard: this.missHeard.slice() });
    if (this.history.length > 200) this.history.shift();
  }

  undo() {
    const h = this.history.pop();
    if (!h) return false;
    Object.assign(this, h);
    return true;
  }

  set(i, st) {
    this.status[i] = st;
  }

  // يُستدعى عند نتيجة نهائية: يعالج كل الكلمات ويسجّل الأخطاء
  // يُرجع عدد الكلمات التي تقدّم فيها المؤشر
  feedFinal(tokens) {
    const before = this.pos;
    // حرف منفرد (مثل "ن" من الغنة عند الوقف) ضوضاء وليس كلمة
    const t = tokens.map(normalizeArabic).filter((x) => x.length > 1);
    for (let i = 0; i < t.length && !this.done; i++) {
      i += this.step(t, i, true) - 1;
    }
    return this.pos - before;
  }

  // نتيجة مؤقتة: نتقدّم فقط على الكلمات المطابقة بلا تسجيل أخطاء
  // يُرجع عدد الكلمات المسموعة التي استُهلكت
  feedInterim(tokens) {
    const t = tokens.map(normalizeArabic);
    let used = 0;
    while (used < t.length && !this.done) {
      if (t[used].length <= 1) { used++; continue; }
      const n = this.step(t, used, false);
      if (!n) break;
      used += n;
    }
    return used;
  }

  // يعالج كلمة مسموعة واحدة؛ يُرجع عدد الكلمات المسموعة المستهلكة (0 = لم يتقدم في الوضع المؤقت)
  step(tokens, i, commit) {
    const W = this.words;
    const p = this.pos;
    const heard = tokens[i];
    const nextHeard = tokens[i + 1];

    const accept = (count) => {
      for (let k = 0; k < count; k++) {
        const corrected = this.missStreak > 0 && k === 0;
        this.set(p + k, corrected ? STATUS.CORRECTED : STATUS.OK);
        if (corrected) this.heardAt[p] = this.missHeard.join(' ');
      }
      this.pos = p + count;
      this.missStreak = 0;
      this.missHeard = [];
      this.afterGap = false;
    };

    // 0) الحروف المقطعة: "الف لام ميم" (عدة كلمات مسموعة) = "الٓمٓ" (كلمة واحدة في المصحف)
    if (W[p].letters) {
      for (let k = Math.min(W[p].letters, tokens.length - i); k >= 2; k--) {
        const joined = tokens.slice(i, i + k).join('');
        if (joined && wordMatches(joined, W[p])) { accept(1); return k; }
      }
    }

    // 1) كلمة مسموعة = كلمتان في المصحف موصولتان
    // (منها أحكام التجويد بين الكلمتين: من ربهم → مربهم، من بعد → ممبعد). نقدّمها على مطابقة الكلمة
    // الأولى وحدها لو كانت أقرب، حتى لا تُحسب "قلوبهمرض" على "قلوبهم" وتسقط "مرض".
    // ولا نقبل كلمة أقصر من أقصر صيغة موصولة حتى لا تُحتسب الثانية وحدها على أنها الكلمتان (ظلمات ≠ في ظلمات)
    let single = wordScore(heard, W[p]);
    // قال لفظ الآية المتشابهة بدل لفظ هذه الآية؟ (فكلوا/وكلوا، خطيكم/خطيتكم)
    if (single && single < 1 && this.rivals[p].some((r) => wordScore(heard, { forms: [r.form] }) > single)) {
      if (!commit) return 0;
      this.set(p, STATUS.WRONG);
      this.heardAt[p] = heard;
      this.pos = p + 1;
      this.missStreak = 0;
      this.missHeard = [];
      return 1;
    }
    if (W[p + 1]) {
      const joined = joinedWord(W[p], W[p + 1]);
      if (heard.length >= Math.min(...joined.forms.map((f) => f.length))) {
        const js = wordScore(heard, joined);
        if (js && js > single) { accept(2); return 1; }
      }
    }
    // 2) مطابقة مباشرة
    if (single) { accept(1); return 1; }
    // 3) كلمتان مسموعتان = كلمة واحدة في المصحف (يا أيها → يٰٓأيها)
    if (nextHeard && wordMatches(heard + nextHeard, W[p])) { accept(1); return 2; }

    if (!commit) return 0;

    // في بداية المقطع كثيراً ما يبدأ القارئ بالاستعاذة أو البسملة أو بآية قبلها:
    // نتجاهل ما لا يطابق، ولا نعتبر الكلمة الأولى ساقطة إلا لو تأكدنا من الكلمتين التاليتين
    if (this.starts[p] && this.missStreak === 0) {
      if (W[p + 2] && nextHeard && wordMatches(heard, W[p + 1]) && wordMatches(nextHeard, W[p + 2])) return this.skipTo(1);
      return 1;
    }

    // 4) أسقط كلمة واحدة وأكمل بالتي بعدها
    if (W[p + 1] && wordMatches(heard, W[p + 1])) return this.skipTo(1);

    // 5) تكرار لكلمات سابقة (إعادة للتثبيت، أو التعرف الصوتي أعاد آخر الجملة بعد وقفة) → تجاهل
    for (let k = 1; k <= 8 && p - k >= 0; k++) {
      if (wordMatches(heard, W[p - k])) return 1;
    }

    // 6) أسقط أكثر من كلمة
    for (let k = 2; k <= 3 && p + k < W.length; k++) {
      const target = W[p + k];
      if (target.forms[0].length < 3) continue; // كلمات قصيرة تسبب مطابقات كاذبة
      if (wordMatches(heard, target)) return this.skipTo(k);
    }

    // كلمة قصيرة جداً لا تطابق شيئاً (مثل "ان" من غنة النون المشددة) غالباً ضوضاء من التعرف الصوتي
    if (heard.length <= 2) return 1;

    // 7) كلمة غير مطابقة: بعد محاولتين خاطئتين نعتبرها خطأ ونكشفها
    this.missStreak++;
    this.missHeard.push(heard);
    if (this.missStreak >= 2) {
      this.set(p, STATUS.WRONG);
      this.heardAt[p] = this.missHeard.join(' ');
      this.pos = p + 1;
      this.missStreak = 0;
      this.missHeard = [];
    }
    return 1;
  }

  // الكلمات من المؤشر حتى p+k-1 سقطت (أو قيل مكان أولها كلمة خطأ)، والكلمة p+k صحيحة
  skipTo(k) {
    const p = this.pos;
    // سقطت كلمة واحدة فقط: لو كانت قصيرة (في، من، ما…) فالتعرف الصوتي كثيراً ما يسقطها وهي مقروءة،
    // ولو كان الميكروفون أعاد التشغيل للتو فقد ضاعت في الفجوة — في الحالتين "لم تُسمع بوضوح" لا خطأ
    const unsure = k === 1 && this.missStreak === 0 && (this.afterGap || this.words[p].forms[0].length <= 2);
    for (let j = 0; j < k; j++) this.set(p + j, unsure ? STATUS.UNSURE : this.missStreak > 0 && j === 0 ? STATUS.WRONG : STATUS.SKIPPED);
    this.afterGap = false;
    if (this.missStreak > 0) this.heardAt[p] = this.missHeard.join(' ');
    this.set(p + k, STATUS.OK);
    this.pos = p + k + 1;
    this.missStreak = 0;
    this.missHeard = [];
    return 1;
  }

  // المستخدم نسي: اكشف الكلمة التالية وسجّلها
  hint() {
    if (this.done) return;
    if (this.missHeard.length) this.heardAt[this.pos] = this.missHeard.join(' ');
    this.missHeard = [];
    this.set(this.pos, STATUS.HINT);
    this.pos++;
    this.missStreak = 0;
  }

  // تقدّم يدوي (وضع بدون ميكروفون)
  revealOk() {
    if (this.done) return;
    this.set(this.pos, this.missStreak > 0 ? STATUS.CORRECTED : STATUS.OK);
    this.pos++;
    this.missStreak = 0;
  }

  // تصحيح يدوي من المستخدم: الضغط على كلمة مكشوفة يبدّل بين صح وخطأ
  toggle(i) {
    if (i >= this.pos) return;
    this.status[i] = isMistake(this.status[i]) ? STATUS.OK : STATUS.WRONG;
  }

  score() {
    const n = this.words.length;
    const done = Math.min(this.pos, n);
    const mistakes = this.status.filter(isMistake).length;
    return { total: n, done, mistakes, accuracy: done ? Math.round(((done - mistakes) / done) * 100) : 0 };
  }
}
