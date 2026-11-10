// SQLite を sql.js（WebAssembly）で動かし、パソコンの node:sqlite（DatabaseSync）と同じ形で使えるようにする。
// iPad のアプリでパソコンの repo.js（main/db/repo.js）をそのまま動かすため（docs/SYNC.md §8）。副作用なし。
// 使う形は repo.js・db.js・backup.js が使うものだけ：prepare(sql).get/all/run・exec(sql)・close()
// - get：1 行（なければ undefined）・all：行の配列・run：{changes, lastInsertRowid}
// - 値：整数・小数は number、文字列、BLOB は Uint8Array、NULL は null（node:sqlite と同じ）

/** 結び付ける値：undefined は NULL に、true/false は 1/0 に（sql.js は undefined を受け取らない） */
const bindable = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }
  /** 1 回だけ使う文（sql.js の文は使い終わったら free する。repo.js は毎回 prepare するので、ためない） */
  #with(params, fn) {
    const st = this.db.raw.prepare(this.sql);
    try {
      if (params.length) st.bind(params.map(bindable));
      return fn(st);
    } finally {
      st.free();
    }
  }
  get(...params) {
    return this.#with(params, (st) => (st.step() ? st.getAsObject() : undefined));
  }
  all(...params) {
    return this.#with(params, (st) => {
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    });
  }
  run(...params) {
    this.#with(params, (st) => {
      while (st.step()) {
        // RETURNING などで行が返っても読み捨てる（run は行を返さない）
      }
    });
    const changes = this.db.raw.getRowsModified();
    const last = this.db.raw.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? 0;
    return {changes, lastInsertRowid: last};
  }
}

export class SqlJsDatabase {
  /** SQL：initSqlJs() が返すもの。bytes：開く SQLite のファイルの中身（なければ空の DB） */
  constructor(SQL, bytes = null) {
    this.raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  exec(sql) {
    this.raw.exec(sql);
  }
  /** いまの中身（SQLite のファイルの形）。iPad に置く・ドライブへ送るときに使う */
  export() {
    return this.raw.export();
  }
  close() {
    this.raw.close();
  }
}
