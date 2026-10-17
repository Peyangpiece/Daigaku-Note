// コネクタの登録と LMS の種類の判定（SPEC §6.3、DESIGN-M0 §1）。
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {detectScore, validateRecipe} from '../../shared/recipe.js';
import {createMoodleConnector} from './moodle.js';

const BUNDLED_RECIPES = fileURLToPath(new URL('../../../recipes/', import.meta.url));

/** 同梱と更新済み（userData/recipes）のレシピを読む。同じ id は版が新しい方 */
export function loadRecipes(dirs = [BUNDLED_RECIPES]) {
  const byId = new Map();
  for (const dir of dirs) {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'schema.json');
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        if (validateRecipe(r).length) continue;
        const cur = byId.get(r.id);
        if (!cur || compareVersion(r.version, cur.version) > 0) byId.set(r.id, r);
      } catch {
        /* 壊れたレシピは飛ばす */
      }
    }
  }
  return [...byId.values()];
}

export function compareVersion(a, b) {
  const pa = String(a).split('.').map(Number),
    pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function createRegistry({fetch: fetchImpl, secrets, log, recipes = loadRecipes(), recipeExecutorFactory = null} = {}) {
  const moodle = createMoodleConnector({fetch: fetchImpl, secrets, log});
  const apis = {moodle};

  return {
    recipes,
    /** 接続行からコネクタを返す */
    forConnection(connection) {
      if (connection.kind === 'api') {
        const c = apis[connection.connector_id];
        if (!c) throw new Error(`知らない API コネクタ: ${connection.connector_id}`);
        return c;
      }
      if (connection.kind === 'recipe') {
        const recipe = recipes.find((r) => r.id === connection.connector_id);
        if (!recipe) throw new Error(`レシピがありません: ${connection.connector_id}`);
        if (!recipeExecutorFactory) throw new Error('レシピ実行器が用意されていません');
        return recipeExecutorFactory(recipe);
      }
      throw new Error(`未対応の接続の種類: ${connection.kind}`);
    },
    /** URL（と取得した HTML）から候補を確からしさの順に返す */
    async detect(url, html = '') {
      const out = [];
      for (const [id, c] of Object.entries(apis)) {
        const score = await c.detect(url, html).catch(() => 0);
        if (score > 0) out.push({connectorId: id, kind: 'api', name: c.name, score});
      }
      for (const r of recipes) {
        const score = detectScore(r, url, html);
        if (score > 0) out.push({connectorId: r.id, kind: 'recipe', name: r.name, score});
      }
      out.sort((a, b) => b.score - a.score);
      out.push({connectorId: 'generic', kind: 'generic', name: '汎用（授業ページの URL を登録）', score: 0});
      return out;
    }
  };
}
