// ポイントの台帳（設定 points）に、ノートを使ったときのポイントを足す（shared/points.js の claimDaily）。
// 数えるのは本体の側だけ：書き込みを保存した（ipc/pdf.js）・資料を初めて開いた（ipc/pdf.js・materials.js・mobile/pad.js）・
// 暗記モードで確かめた（ipc/pdf.js）。失敗しても、もとの操作は止めない
import {claimDaily, dayOf} from '../shared/points.js';

export function createLedger({repo, log = () => {}, now = () => new Date()}) {
  /** kind：'write'・'page'・'read'・'recall'。key：その日に 1 回だけ数えるための名前。戻り：もらった量 */
  const claim = (kind, key) => {
    try {
      const r = claimDaily(repo.getSetting('points', null), kind, key, {now: now()});
      if (r.gained) repo.setSetting('points', r.points);
      return r.gained;
    } catch (e) {
      log(`points: ${e.message}`);
      return 0;
    }
  };
  return {
    claim,
    /**
     * 書き込みを保存した：今日作った書き込みが残っているページを数える（書いてすぐ消したものは残っていないので数えない）。
     * rows：そのファイルの注釈の行（created_at・page）。fileKey：ファイルの名前（注釈の鍵）
     */
    wrote(fileKey, rows) {
      const today = dayOf(now());
      const pages = [...new Set(rows.filter((r) => dayOf(new Date(r.created_at)) === today).map((r) => r.page))];
      if (!pages.length) return 0;
      let gained = claim('write', today);
      for (const p of pages) gained += claim('page', `${fileKey}:${p}`);
      return gained;
    }
  };
}
