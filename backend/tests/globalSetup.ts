import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const backendDir = path.resolve(__dirname, '..');
const TEST_DB = path.resolve(backendDir, 'prisma/test.db');
const url = `file:${TEST_DB}`;

function cleanup() {
  for (const f of [TEST_DB, `${TEST_DB}-journal`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

// Cria o schema do banco de teste aplicando as migrations existentes a um
// banco SQLite descartável. Como o datasource do schema tem URL fixa, geramos
// um schema temporário apontando para o banco de teste apenas para o migrate.
export default function setup() {
  cleanup();

  const schemaPath = path.resolve(backendDir, 'prisma/schema.prisma');
  const tmpSchema = path.resolve(backendDir, 'prisma/schema.test.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8').replace(/url\s*=\s*"[^"]*"/, `url = "${url}"`);
  fs.writeFileSync(tmpSchema, schema);

  try {
    execSync(`npx prisma migrate deploy --schema "${tmpSchema}"`, {
      cwd: backendDir,
      stdio: 'ignore',
      env: { ...process.env, DATABASE_URL: url },
    });
  } finally {
    fs.unlinkSync(tmpSchema);
  }

  return () => cleanup();
}
