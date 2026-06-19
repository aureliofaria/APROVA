import { defineConfig } from 'vitest/config';
import path from 'path';

// Banco SQLite isolado para os testes (absoluto, para casar CLI e client).
const TEST_DB = path.resolve(__dirname, 'prisma/test.db');

export default defineConfig({
  test: {
    globalSetup: './tests/globalSetup.ts',
    env: { DATABASE_URL: `file:${TEST_DB}` },
    // Um único banco SQLite compartilhado: evita concorrência entre arquivos.
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
