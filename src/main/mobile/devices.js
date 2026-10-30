// スマホ連携（docs/MOBILE.md §2）：つないだスマホの一覧と鍵。
// 一覧（名前・つないだ日・最後に使った日）は設定 mobile.devices に、鍵は secrets（OS の仕組みで暗号化）に持つ。
// 「スマホを追加」で作った端末は、10 分以内に 1 回つなぐまで「待ち」（pending）。つなげば待ちが外れ、使わなければ消える
import {ulid} from '../../shared/ids.js';
import {KEY_BYTES, fromB64, randomBytes, toB64} from '../../shared/mobile-wire.js';

export const PAIR_TTL_MS = 10 * 60 * 1000;
const NAME_MAX = 40;

/** User-Agent からスマホの種類の名前（iPhone・iPad・Android・スマホ） */
export function deviceName(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  return 'スマホ';
}

export function createDevices({repo, secrets, now = () => Date.now()}) {
  const keys = new Map(); // 鍵の写し（secrets を毎回読まない）
  const read = () => {
    const list = repo.getSetting('mobile.devices', []);
    return Array.isArray(list) ? list : [];
  };
  const write = (list) => repo.setSetting('mobile.devices', list);
  const forget = async (id) => {
    keys.delete(id);
    await secrets.remove(`mobile.key.${id}`).catch(() => {});
  };
  /** 期限の切れた待ちを捨てる */
  const prune = async () => {
    const list = read();
    const dead = list.filter((d) => d.pending && d.expires < now());
    if (!dead.length) return list;
    for (const d of dead) await forget(d.id);
    const alive = list.filter((d) => !dead.includes(d));
    write(alive);
    return alive;
  };

  return {
    /** 画面に出す一覧（鍵は含めない） */
    async list() {
      return (await prune())
        .filter((d) => !d.pending)
        .map(({id, name, created, lastSeen, ip}) => ({id, name, created, lastSeen, ip: ip ?? null}));
    },
    /** 新しい端末（待ち）を作り、鍵を返す。QR に入れる */
    async create() {
      await prune();
      const id = ulid(now());
      const key = randomBytes(KEY_BYTES);
      await secrets.set(`mobile.key.${id}`, toB64(key));
      keys.set(id, key);
      const created = new Date(now()).toISOString();
      write([...read(), {id, name: 'スマホ', created, lastSeen: null, pending: true, expires: now() + PAIR_TTL_MS}]);
      return {id, key};
    },
    /** 端末の鍵。知らない端末・期限の切れた待ちは null */
    async keyOf(id) {
      const d = read().find((x) => x.id === id);
      if (!d) return null;
      if (d.pending && d.expires < now()) {
        await prune();
        return null;
      }
      if (!keys.has(id)) {
        const k = await secrets.get(`mobile.key.${id}`);
        if (!k) return null;
        const key = fromB64(k);
        if (key.length !== KEY_BYTES) return null;
        keys.set(id, key);
      }
      return keys.get(id);
    },
    /** まだ QR を読んだだけ（待ち）の端末か */
    isPending(id) {
      return !!read().find((x) => x.id === id)?.pending;
    },
    /**
     * 初めてつながった：鍵を新しくして（QR の鍵はもう使えない＝QR は 1 回だけ）、待ちを外し、名前を付ける。新しい鍵を返す
     */
    async activate(id, ua) {
      const list = read();
      const d = list.find((x) => x.id === id);
      if (!d?.pending) return null;
      const key = randomBytes(KEY_BYTES);
      await secrets.set(`mobile.key.${id}`, toB64(key));
      keys.set(id, key);
      d.pending = false;
      delete d.expires;
      d.name = deviceName(ua);
      d.lastSeen = new Date(now()).toISOString();
      write(list);
      return key;
    },
    /**
     * 使った（最後に使った日・つないできた所と種類を残す。日は 1 分に 1 回まで書く）。
     * 前と違う所（IP）・違うブラウザ（User-Agent）からつながったら {name, from, to} を返す（段階 1 の暫定の見張り。docs/MOBILE.md §3）
     */
    seen(id, {ip = null, ua = null} = {}) {
      const list = read();
      const d = list.find((x) => x.id === id);
      if (!d || d.pending) return null;
      const t = now();
      const addr = ip ? String(ip).replace(/^::ffff:/, '') : null;
      const agent = ua ? String(ua).slice(0, 200) : null;
      const moved =
        (addr && d.ip && d.ip !== addr) || (agent && d.ua && d.ua !== agent)
          ? {id, name: d.name, from: d.ip, to: addr ?? d.ip, uaChanged: !!(agent && d.ua && d.ua !== agent)}
          : null;
      const fresh = !d.lastSeen || t - Date.parse(d.lastSeen) >= 60_000;
      if (!fresh && !moved && (d.ip || !addr)) return null;
      d.lastSeen = new Date(t).toISOString();
      if (addr) d.ip = addr;
      if (agent) d.ua = agent;
      write(list);
      return moved;
    },
    rename(id, name) {
      const clean = String(name ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NAME_MAX);
      if (!clean) throw new Error('名前を入れてください');
      const list = read();
      const d =
        list.find((x) => x.id === id) ??
        (() => {
          throw new Error('このスマホは見つかりませんでした');
        })();
      d.name = clean;
      write(list);
    },
    async remove(id) {
      write(read().filter((x) => x.id !== id));
      await forget(id);
    }
  };
}
