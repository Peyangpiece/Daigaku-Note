// 組み立て（build-www.mjs）で src/shared/google-client.js の本体に置き換わる。テスト（node）ではここから本体を読む
export * from '../../../src/shared/google-client.js';
