// 間違いの検出だけ（整形は Prettier）
export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly', process: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly',
        fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', AbortSignal: 'readonly', TextEncoder: 'readonly',
        Intl: 'readonly', confirm: 'readonly', window: 'readonly', document: 'readonly', location: 'readonly', CustomEvent: 'readonly', require: 'readonly',
        IntersectionObserver: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
      'no-undef': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart']
    }
  },
  {ignores: ['node_modules/', 'release/', 'dist/']}
];
