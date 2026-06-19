import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Usuário administrador padrão
  const adminEmail = 'admin@aprova.local';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: { name: 'Administrador', email: adminEmail, passwordHash, role: 'ADMIN' },
    });
    console.log(`Usuário admin criado: ${adminEmail} / admin123`);
  }

  // Departamentos base
  const departments = ['TI', 'Administrativo', 'Financeiro', 'Recursos Humanos'];
  for (const name of departments) {
    const exists = await prisma.department.findFirst({ where: { name } });
    if (!exists) await prisma.department.create({ data: { name } });
  }

  // Almoxarifado padrão
  const whCode = 'ALM-01';
  const wh = await prisma.warehouse.findUnique({ where: { code: whCode } });
  if (!wh) {
    await prisma.warehouse.create({
      data: { code: whCode, name: 'Almoxarifado Central', description: 'Estoque central de TI e Administrativo' },
    });
  }

  // Catálogo inicial de itens (TI e Administrativo)
  const catalog = [
    { code: 'NB-DELL-5430', name: 'Notebook Dell Latitude 5430', type: 'TI', category: 'HARDWARE', brand: 'Dell', model: 'Latitude 5430' },
    { code: 'MON-LG-24', name: 'Monitor LG 24"', type: 'TI', category: 'PERIFERICO', brand: 'LG', model: '24MK430H' },
    { code: 'SMART-SAMS-A54', name: 'Smartphone Samsung Galaxy A54', type: 'TI', category: 'SMARTPHONE', brand: 'Samsung', model: 'Galaxy A54' },
    { code: 'CHIP-VIVO', name: 'Chip / Linha Telefônica Vivo', type: 'TI', category: 'CHIP', brand: 'Vivo', model: 'SIM' },
    { code: 'CAD-EXEC', name: 'Cadeira Executiva', type: 'ADMINISTRATIVO', category: 'MOBILIARIO', brand: null, model: null },
    { code: 'MESA-ESCR', name: 'Mesa de Escritório', type: 'ADMINISTRATIVO', category: 'MOBILIARIO', brand: null, model: null },
  ];
  for (const c of catalog) {
    const exists = await prisma.inventoryItem.findUnique({ where: { code: c.code } });
    if (!exists) await prisma.inventoryItem.create({ data: c });
  }

  console.log('Seed concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
