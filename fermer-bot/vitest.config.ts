import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:sqlite hali "experimental" - ogohlantirish test chiqishini to'ldirmasin
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
