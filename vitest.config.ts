import { configDefaults, defineConfig } from 'vitest/config';

// proxy/ と vscode/ は別の package。ルートのテストには混ぜない。
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'proxy/**', 'vscode/**'],
  },
});
