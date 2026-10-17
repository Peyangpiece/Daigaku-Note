// 秘密の保管（DESIGN-M0 §7）。Electron の safeStorage で暗号化し、userData/secrets.json に置く。
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
        return JSON.parse(s.decryptString(Buffer.from(all[key], 'base64')));
      } catch (e) {
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
    },
    async remove(key) {
      const all = load();
      delete all[key];
      save(all);
    },
    async removeByPrefix(prefix) {
      const all = load();
      for (const k of Object.keys(all)) if (k.startsWith(prefix)) delete all[k];
      save(all);
    },
    keys() {
      return Object.keys(load());
    }
  };
}
