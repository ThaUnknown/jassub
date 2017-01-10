import config from 'eslint-config-standard-universal'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...config(),
  {
    ignores: ["src/worker/pre-worker.js"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
  }
)