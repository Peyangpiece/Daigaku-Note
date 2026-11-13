// IPC の窓口：資料をまたいで探す（search.*。SPEC §8.1）。index.js が register を呼ぶ
import {createSearch} from '../search.js';
import {str} from './common.js';

export function register({handle, ctx, repo, log}) {
  // 探す窓口が初めて呼ばれたときに用意する（iPad の中で動かすとき〔src/local〕も同じ窓口を使う）
  const search = () => (ctx.search ??= createSearch({repo, log: (m) => log.info(m)}));
  // 探す。まだ本文を読んでいない資料があれば、裏で読み始める（pending が 0 になるまで、画面が探し直す）
  handle('search.query', ({q}) => {
    const r = search().query(str(q, 200) ?? '');
    if (r.pending)
      search()
        .index()
        .catch((e) => log.warn(`search: ${e.message}`));
    return r;
  });
}
