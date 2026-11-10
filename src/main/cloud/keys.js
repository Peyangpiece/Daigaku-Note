// Google ドライブに置くものの鍵（docs/SYNC.md §3）：計算は iPad と同じ shared/vault-keys.js。新しい元の鍵を作るのはパソコンだけ
import {randomBytes} from 'node:crypto';
import {VAULT_KEY_BYTES} from '../../shared/vault.js';

export {blobName, deriveKeys, fingerprint, keyQr} from '../../shared/vault-keys.js';

export const newMasterKey = () => new Uint8Array(randomBytes(VAULT_KEY_BYTES));
