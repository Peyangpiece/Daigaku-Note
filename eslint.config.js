// 間違いの検出（整形は Prettier）。ESLint の recommended を土台に、環境ごとの globals を足す
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {...globals.node, ...globals.browser}
    },
    rules: {
      'no-unused-vars': ['warn', {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none'}],
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart'],
      // 握りつぶす catch は理由のコメントを付ける決まり（空の catch そのものは許す）
      'no-empty': ['error', {allowEmptyCatch: true}],
      // 文字列の中の \\. など、正規表現と見分けにくいものが多いので warn に
      'no-useless-escape': 'warn',
      // ファイル名の整形で制御文字を消す正規表現はわざと書いている
      'no-control-regex': 'off',
      // 日本語の文字列（全角の空白）は許す
      'no-irregular-whitespace': [
        'error',
        {skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true}
      ]
    }
  },
  {files: ['**/*.cjs'], languageOptions: {sourceType: 'commonjs', globals: {...globals.node}}},
  {ignores: ['node_modules/', 'release/', 'dist/', 'src/renderer/vendor/']}
];
