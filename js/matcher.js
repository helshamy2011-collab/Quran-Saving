// محرك المطابقة: يقارن الكلمات المسموعة بنص المصحف كلمة كلمة
// ويحدد: صحيح / خطأ / سقط (تخطّاه) / نسيه (طلب تلميح) / تردد ثم صحّح

import { normalizeArabic, wordMatches, wordScore, joinedWord, rivalsOf, isWawFaVariant, isQuranWord } from './quran.js';

export const STATUS = {
  HIDDEN: 'hidden',
  OK: 'ok',
  CORRECTED: 'corrected', // تلعثم أو قال كلمة خطأ ثم صحّح نفسه
  WRONG: 'wrong',         // قال كلمة أخرى مكانها
  SKIPPED: 'skipped',     // أسقطها وأكمل بعدها
  HINT: 'hint',           // نسيها وطلب تلميحاً
  GIVEN: 'given',         // بداية السؤال في «كمّل الآية»: ظاهرة ولا تُحسب في النتيجة
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
    this.heardHist = [];   // آخر الكلمات المسموعة (لحذف ما يعيده التعرف الصوتي في بداية الجملة التالية)
    this.history = [];
    // ---- الأدلة: ما سمعه محرك التعرف، منفصل عن الحكم (status) ----
    // لكل كلمة متوقعة: [{ raw, norm, place }] — place: 'in' سُمع مكانها | 'before' سُمع قبل ما تتطابق
    this.evidence = words.map(() => []);
    this.matchedRaw = words.map(() => ''); // الكلمة المسموعة (كما كتبها المحرك) اللي طابقت الكلمة
    this.unplaced = [];  // كلمات مسموعة لم تُنسب بعد لموضع (قد تكون أكثر من كلمة في نفس التلاوة)
    this.lastFinal = null; // آخر نتيجة نهائية: الخام والمطبّع وما استُخدم منها
  }

  // نسب الكلمات المسموعة غير المنسوبة للمواضع p…p+k-1 بالترتيب. لو المسموع أكثر من المواضع
  // فالزائد الأقدم سُمع «قبل» p (استعاذة، تردد…) وليس مكانها
  placeHeard(p, k = 1, place = 'in') {
    const list = this.unplaced;
    this.unplaced = [];
    if (!list.length || p >= this.words.length) return;
    const slots = Math.min(k, this.words.length - p);
    const extra = place === 'in' ? Math.max(0, list.length - slots) : list.length;
    list.forEach((h, j) => {
      if (j < extra) this.evidence[p].push({ ...h, place: 'before' });
      else this.evidence[p + (j - extra)].push({ ...h, place: 'in' });
    });
  }

  // ما الذي سمعه المحرك في موضع الكلمة i (منفصل عن الحكم status):
  // matched سمعها ومطابقة | heard-unclear سمع شيئاً مكانها والدليل غير كافٍ للحكم
  // heard-mismatch سمع شيئاً مكانها وحُكم بأنه لا يطابق | not-heard لم يسمع شيئاً مكانها | pending لم يصل لها
  heardState(i) {
    const st = this.status[i];
    if (st === STATUS.GIVEN) return 'given';
    if (st === STATUS.HIDDEN) return 'pending';
    if (st === STATUS.OK || st === STATUS.CORRECTED) return 'matched';
    const heard = this.evidence[i].some((e) => e.place === 'in');
    if (!heard) return 'not-heard';
    return st === STATUS.UNSURE ? 'heard-unclear' : 'heard-mismatch';
  }

  // التعرف الصوتي (خاصة على الآيفون) قد يعيد آخر ما سمعه في بداية النتيجة التالية:
  // "قل أعوذ برب الناس" ثم "قل أعوذ برب الناس ملك الناس". نحذف الجزء المكرر قبل المطابقة.
  dropOverlap(t) {
    const hist = this.heardHist;
    // لو بداية النتيجة هي الكلمة المنتظرة فعلاً فليست تكراراً (آيات فيها ألفاظ متكررة: ثم كفروا ثم…)
    if (!t.length || this.done || wordMatches(t[0], this.words[this.pos])) return t;
    const same = (a, b) => a === b || wordMatches(a, { forms: [b] });
    for (let k = Math.min(hist.length, t.length); k >= 2; k--) {
      let ok = true;
      for (let j = 0; j < k && ok; j++) ok = same(t[j], hist[hist.length - k + j]);
      if (ok) return t.slice(k);
    }
    return t;
  }

  // عدد الكلمات في بداية نتيجة مؤقتة هي إعادة لما قُرئ بالفعل (الآيفون يعيد النص أو يعدّل تقسيمه):
  // "الله الصمد لم يلد ولم يولد" وقد وصلنا إلى "ولم" ← نتخطى أول ٤ كلمات
  replayLen(t) {
    if (!t.length || this.done) return 0;
    const W = this.words;
    const first = t.findIndex((x) => x.length > 1);
    if (first < 0 || wordMatches(t[first], W[this.pos])) return 0;
    const back = Math.min(this.pos, 12);
    for (let k = back; k >= 1; k--) {
      // هل تبدأ النتيجة بآخر k كلمات تجاوزناها؟
      let j = 0;
      let i = this.pos - k;
      while (j < t.length && i < this.pos) {
        if (t[j].length <= 1) { j++; continue; }
        if (!wordMatches(t[j], W[i])) break;
        i++; j++;
      }
      if (i === this.pos) return j;
    }
    return this.dropLen(t);
  }

  // نفس فكرة dropOverlap لكن تُرجع عدد الكلمات المحذوفة
  dropLen(t) {
    const kept = t.filter((x) => x.length > 1);
    const rest = this.dropOverlap(kept);
    let drop = kept.length - rest.length;
    if (!drop) return 0;
    let j = 0;
    while (j < t.length && drop) { if (t[j].length > 1) drop--; j++; }
    return j;
  }

  remember(tokens) {
    this.heardHist.push(...tokens);
    if (this.heardHist.length > 40) this.heardHist.splice(0, this.heardHist.length - 40);
  }

  get done() { return this.pos >= this.words.length; }

  clone() {
    const m = new Matcher(this.words);
    m.status = this.status.slice();
    m.heardAt = this.heardAt.slice();
    m.pos = this.pos;
    m.missStreak = this.missStreak;
    m.missHeard = this.missHeard.slice();
    m.evidence = this.evidence.map((a) => a.slice());
    m.matchedRaw = this.matchedRaw.slice();
    m.unplaced = this.unplaced.slice();
    return m;
  }

  snapshot() {
    this.history.push({
      status: this.status.slice(), heardAt: this.heardAt.slice(), pos: this.pos, missStreak: this.missStreak, missHeard: this.missHeard.slice(),
      evidence: this.evidence.map((a) => a.slice()), matchedRaw: this.matchedRaw.slice(), unplaced: this.unplaced.slice(),
    });
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
    const raw = tokens.slice();
    const norm = raw.map(normalizeArabic);
    // حرف منفرد (مثل "ن" من الغنة عند الوقف) لا يدخل المطابقة، لكنه يُحفظ دليلاً في موضعه
    const idx = norm.map((x, j) => j).filter((j) => norm[j].length > 1);
    const kept = this.dropOverlap(idx.map((j) => norm[j]));
    const overlap = new Set(idx.slice(0, idx.length - kept.length));
    const use = idx.slice(idx.length - kept.length);
    const t = use.map((j) => norm[j]);
    this.rawTok = use.map((j) => raw[j]);
    // الحروف المنفردة قبل كل كلمة مستخدمة (وبعد آخرها)
    const letters = (from, to) => {
      const out = [];
      for (let x = from; x < to; x++) if (norm[x].length <= 1 && !overlap.has(x) && raw[x]) out.push({ raw: raw[x], norm: norm[x] });
      return out;
    };
    let i = 0;
    while (i < t.length && !this.done) {
      this.unplaced.push(...letters(i ? use[i - 1] + 1 : 0, use[i]));
      const n = this.step(t, i, true);
      for (let x = 1; x < n; x++) this.unplaced.push(...letters(use[i + x - 1] + 1, use[i + x]));
      i += n;
    }
    if (!this.done) this.unplaced.push(...letters(use.length ? use.at(-1) + 1 : 0, raw.length));
    this.remember(t);
    this.rawTok = null;
    // الطبقات منفصلة: الخام كما جاء، والمطبّع، ودور كل كلمة (مطابقة / تكرار لما سبق / حرف منفرد)
    this.lastFinal = {
      raw: raw.join(' '),
      normalized: t.join(' '),
      tokens: raw.map((r, j) => ({ raw: r, norm: norm[j], role: overlap.has(j) ? 'overlap' : norm[j].length <= 1 ? 'letter' : 'input' })),
    };
    return this.pos - before;
  }

  // نتيجة مؤقتة: نتقدّم فقط على الكلمات المطابقة بلا تسجيل أخطاء
  // يُرجع عدد الكلمات المسموعة التي استُهلكت
  feedInterim(tokens) {
    const t = tokens.map(normalizeArabic);
    this.rawTok = tokens.slice(); // نفس الترتيب: الكلمة المطابقة تُحفظ كما كتبها المحرك
    let used = this.replayLen(t);
    while (used < t.length && !this.done) {
      if (t[used].length <= 1) { used++; continue; }
      const n = this.step(t, used, false);
      if (!n) break;
      used += n;
    }
    this.rawTok = null;
    this.remember(t.slice(0, used).filter((x) => x.length > 1));
    return used;
  }

  // يعالج كلمة مسموعة واحدة؛ يُرجع عدد الكلمات المسموعة المستهلكة (0 = لم يتقدم في الوضع المؤقت)
  step(tokens, i, commit) {
    const W = this.words;
    const p = this.pos;
    const heard = tokens[i];
    const nextHeard = tokens[i + 1];
    const rawOf = (j) => this.rawTok?.[j] ?? tokens[j];
    // كلمة مسموعة لم تطابق موضعها: تُحفظ دليلاً حتى تُنسب لموضع (لا تُحذف)
    const hold = () => { if (commit) this.unplaced.push({ raw: rawOf(i), norm: heard }); };

    const accept = (count, rawHeard = rawOf(i)) => {
      // ما سُمع قبلها ولم يطابق (تردد، ضوضاء، استعاذة…) يُحفظ دليلاً «قبلها» دون تغيير الحكم
      this.placeHeard(p, 1, 'before');
      for (let k = 0; k < count; k++) {
        const corrected = this.missStreak > 0 && k === 0;
        this.set(p + k, corrected ? STATUS.CORRECTED : STATUS.OK);
        if (corrected) this.heardAt[p] = this.missHeard.join(' ');
        this.matchedRaw[p + k] = rawHeard;
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
        if (joined && wordMatches(joined, W[p])) { accept(1, tokens.slice(i, i + k).map((x, j) => rawOf(i + j)).join(' ')); return k; }
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
      hold();
      this.placeHeard(p, 1, 'in');
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
    if (nextHeard && wordMatches(heard + nextHeard, W[p])) { accept(1, `${rawOf(i)} ${rawOf(i + 1)}`); return 2; }

    if (!commit) return 0;

    // في بداية المقطع كثيراً ما يبدأ القارئ بالاستعاذة أو البسملة أو بآية قبلها:
    // نتجاهل ما لا يطابق، ولا نعتبر الكلمة الأولى ساقطة إلا لو تأكدنا من الكلمتين التاليتين
    if (this.starts[p] && this.missStreak === 0) {
      if (W[p + 2] && nextHeard && wordMatches(heard, W[p + 1]) && wordMatches(nextHeard, W[p + 2])) return this.skipTo(1, rawOf(i));
      hold();
      return 1;
    }

    // 4) أسقط كلمة واحدة وأكمل بالتي بعدها
    if (W[p + 1] && wordMatches(heard, W[p + 1])) return this.skipTo(1, rawOf(i));

    // 5) تكرار لكلمات سابقة (إعادة للتثبيت، أو التعرف الصوتي أعاد آخر الجملة بعد وقفة) → تجاهل
    for (let k = 1; k <= 8 && p - k >= 0; k++) {
      if (wordMatches(heard, W[p - k])) return 1;
    }

    // 6) أسقط أكثر من كلمة
    for (let k = 2; k <= 3 && p + k < W.length; k++) {
      const target = W[p + k];
      if (target.forms[0].length < 3) continue; // كلمات قصيرة تسبب مطابقات كاذبة
      if (wordMatches(heard, target)) return this.skipTo(k, rawOf(i));
    }

    // إعادة التزامن: أسقط جملة كاملة (٤ كلمات فأكثر) — نبحث أبعد بشرط تطابق كلمتين متتاليتين
    if (nextHeard) {
      for (let k = 4; k <= 12 && p + k + 1 < W.length; k++) {
        if (wordMatches(heard, W[p + k]) && wordMatches(nextHeard, W[p + k + 1])) return this.skipTo(k, rawOf(i));
      }
    }

    // كلمة قصيرة جداً لا تطابق شيئاً (مثل "ان" من غنة النون المشددة) غالباً ضوضاء من التعرف الصوتي:
    // لا تُحسب محاولة خاطئة، لكنها تُحفظ دليلاً وتُنسب لموضعها (قد تكون «إن» مكان «لئن»)
    if (heard.length <= 2) { hold(); return 1; }

    // 7) كلمة غير مطابقة: بعد محاولتين خاطئتين نعتبرها خطأ ونكشفها
    hold();
    this.missStreak++;
    this.missHeard.push(heard);
    if (this.missStreak >= 2) {
      this.placeHeard(p, 1, 'in');
      this.set(p, STATUS.WRONG);
      this.heardAt[p] = this.missHeard.join(' ');
      this.pos = p + 1;
      this.missStreak = 0;
      this.missHeard = [];
    }
    return 1;
  }

  // الكلمات من المؤشر حتى p+k-1 سقطت (أو قيل مكان أولها كلمة خطأ)، والكلمة p+k صحيحة
  // rawHeard: الكلمة المسموعة اللي طابقت p+k
  skipTo(k, rawHeard = '') {
    const p = this.pos;
    // ما سُمع ولم يطابق يُنسب للكلمات الساقطة بالترتيب (دليل، لا يغيّر الحكم)
    this.placeHeard(p, k, 'in');
    // التعرف الصوتي العام ضعيف مع التلاوة: كثيراً ما يسقط كلمة أو كلمتين أو يكتبهما كلاماً مشوشاً
    // ("من شر" ← "يشل"). فلا نحسب الخطأ إلا بدليل واضح: زيادة/حذف واو أو فاء (واحد/أحد)، أو قال
    // مكانها كلمة قرآنية أخرى (ربي بدل برب)، أو أسقط ٣ كلمات فأكثر. أما كلمة أو كلمتان سقطتا أو
    // تشوشتا بكلام ليس من القرآن فـ"لم تُسمع بوضوح"
    const garbled = this.missStreak > 0;
    const clearWrong = this.saidOther(p);
    const unsure = k <= 2 && !clearWrong;
    for (let j = 0; j < k; j++) this.set(p + j, unsure ? STATUS.UNSURE : garbled && j === 0 ? STATUS.WRONG : STATUS.SKIPPED);
    this.afterGap = false;
    if (this.missStreak > 0) this.heardAt[p] = this.missHeard.join(' ');
    this.set(p + k, STATUS.OK);
    this.matchedRaw[p + k] = rawHeard;
    this.pos = p + k + 1;
    this.missStreak = 0;
    this.missHeard = [];
    return 1;
  }

  // المستخدم أنهى التسميع والكلمات الأخيرة (كلمة أو كلمتان) لم تصل من التعرف الصوتي:
  // غالباً قالها والتعرف توقف قبل كتابتها
  // دليل واضح إن المستخدم قال كلمة تانية مكان الكلمة p: واو/فاء زائدة أو ناقصة، أو كلمة قرآنية أخرى
  saidOther(p) {
    return this.missStreak > 0 && this.missHeard.some((h) => isWawFaVariant(h, this.words[p]) || (h.length >= 3 && isQuranWord(h)));
  }

  finishTail(max = 2) {
    const left = this.words.length - this.pos;
    if (left <= 0 || left > max || this.pos === 0) return false;
    // قال كلمة تانية مكان أول كلمة باقية (ومفيش بعدها حاجة تأكد): خطأ، والباقي لم يُسمع بوضوح
    if (this.saidOther(this.pos)) {
      this.placeHeard(this.pos, 1, 'in');
      this.set(this.pos, STATUS.WRONG);
      this.heardAt[this.pos] = this.missHeard.join(' ');
      this.pos++;
      this.missStreak = 0;
      this.missHeard = [];
    }
    this.placeHeard(this.pos, this.words.length - this.pos, 'in');
    for (let i = this.pos; i < this.words.length; i++) this.set(i, STATUS.UNSURE);
    this.pos = this.words.length;
    return true;
  }

  // المستخدم نسي: اكشف الكلمة التالية وسجّلها
  hint() {
    if (this.done) return;
    if (this.missHeard.length) this.heardAt[this.pos] = this.missHeard.join(' ');
    this.missHeard = [];
    this.placeHeard(this.pos, 1, 'in');
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
  // أول k كلمات معطاة (بداية السؤال): لا تُقرأ ولا تُحسب
  give(k) {
    for (let i = 0; i < k && i < this.words.length; i++) this.status[i] = STATUS.GIVEN;
    this.pos = Math.max(this.pos, Math.min(k, this.words.length));
  }

  toggle(i) {
    if (i >= this.pos || this.status[i] === STATUS.GIVEN) return;
    this.status[i] = isMistake(this.status[i]) ? STATUS.OK : STATUS.WRONG;
  }

  score() {
    const given = this.status.filter((x) => x === STATUS.GIVEN).length;
    const n = this.words.length - given;
    const done = Math.min(this.pos, this.words.length) - given;
    const mistakes = this.status.filter(isMistake).length;
    return { total: n, done, mistakes, accuracy: done ? Math.round(((done - mistakes) / done) * 100) : 0 };
  }
}
