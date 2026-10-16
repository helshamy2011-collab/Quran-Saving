// التصحيح الفوري بالصوت: لما تغلط في كلمة أو تسقطها أو تضغط «نسيتها» يقولها لك القارئ صح
// الميكروفون يفضل شغال: الكلمة اتعلّمت وعدّيناها، فلو سمعها من السماعة بتتجاهَل كتكرار،
// وكلامك بعدها ما يضيعش لو كمّلت على طول

import { Player, wordUrl, ayahUrl } from './audio.js';

export function voiceFix(rec, { enabled, reciter }) {
  const player = new Player();

  function onMistake(indices) {
    if (!enabled() || !indices.length) return;
    const list = indices.slice(0, 3).map((i) => rec.words[i]);
    rec.heardEl.textContent = `الصح: ${list.map((w) => w.text).join(' ')}`;
    // صوت الكلمة؛ ولو تعذّر نُسمعه الآية كاملة مرة واحدة
    player.play(list.map((w, n) => ({ urls: n === 0 ? [wordUrl(w.g, w.w), ayahUrl(w.g, reciter())] : [wordUrl(w.g, w.w)] })));
  }

  return {
    onMistake,
    stop() { player.stop(); },
  };
}
