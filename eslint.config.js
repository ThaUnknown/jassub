import config from 'eslint-config-standard-universal'
import tseslint from 'typescript-eslint'
import _globals from 'globals'

export default tseslint.config(
  ...config({
  ..._globals.browser,
  ..._globals.worker,
  ..._globals.serviceworker,
  Deno: false
}),
  {
    ignores: ["src/worker/pre-worker.js"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
  }
)