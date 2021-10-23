module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'google',
  ],
  parserOptions: {
    'ecmaVersion': 12,
    'sourceType': 'module',
  },
  rules: {
    quotes: ['error', 'single'],
    semi: ['error', 'never'],
  },
}
