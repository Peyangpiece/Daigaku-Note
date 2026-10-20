// 秘密の保管（DESIGN-M0 §7）。Electron の safeStorage で暗号化し、userData/secrets.json に置く。
// Mac の safeStorage の鍵はキーチェーンの「大学ノート Safe Storage」にあり、読めるのは許可したアプリの署名だけ。
// 署名が変わった版やキーチェーンの確認で「拒否」したときは復号できない。そのときも暗号文は消さない（許可すれば読める）
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

export function createSecrets(file, log, safeStorageImpl = null) {
  const ss = safeStorageImpl ?? (async () => (await import('electron')).safeStorage);
  const load = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const save = (all) => {
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, JSON.stringify(all), {mode: 0o600});
  };
  const storage = async () => (typeof ss === 'function' ? ss() : ss);
  const locked = new Set(); // 保存してあるのに復号できなかった鍵
  return {
    async available() {
      const s = await storage();
      return s.isEncryptionAvailable();
    },
    async get(key) {
      const all = load();
      if (!all[key]) return null;
      try {
        const s = await storage();
        const value = JSON.parse(s.decryptString(Buffer.from(all[key], 'base64')));
        locked.delete(key);
        return value;
      } catch (e) {
        locked.add(key);
        log?.warn?.(`秘密を復号できません: ${key}`);
        return null;
      }
    },
    async set(key, value) {
      const s = await storage();
      if (!s.isEncryptionAvailable()) throw new Error('この環境では秘密を保存できません');
      const all = load();
      all[key] = s.encryptString(JSON.stringify(value)).toString('base64');
      save(all);
      locked.delete(key);
    },
    async remove(key) {
      const all = load();
      delete all[key];
      save(all);
      locked.delete(key);
    },
    async removeByPrefix(prefix) {
      const all = load();
      for (const k of Object.keys(all)) if (k.startsWith(prefix)) delete all[k];
      save(all);
      for (const k of [...locked]) if (k.startsWith(prefix)) locked.delete(k);
    },
    /** 保存してあるのに復号できなかったか（prefix で始まる鍵のどれか。get を試したあとで分かる） */
    isLocked(prefix) {
      return [...locked].some((k) => k.startsWith(prefix));
    },
    keys() {
      return Object.keys(load());
    }
  };
}
