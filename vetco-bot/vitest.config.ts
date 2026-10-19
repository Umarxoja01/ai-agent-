import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BOT_TOKEN: '123:TEST',
            WEBHOOK_SECRET: 'test-secret-0123456789',
            ADMIN_TOKEN: 'admin-token',
            ADMIN_CHAT_ID: '-100777',
            ADMIN_USER_IDS: '500',
            BOT_USERNAME: 'vetco_test_bot',
            TELEGRAM_API: 'https://tg.test',
            CATALOG_CSV_URL: 'https://sheet.test/catalog.csv',
            PAYME_URL: 'https://payme.test/pay?order={order}&amount={amount}',
            CLICK_URL: '',
            CONTACT_PHONE: '+998 90 000 00 00',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
