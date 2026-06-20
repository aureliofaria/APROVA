import { Router, Request as ExpressRequest, Response } from 'express';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

/**
 * Builds the Prisma `where` filter from query params shared by the listing and
 * the Excel export so both stay consistent.
 */
function buildWhere(query: ExpressRequest['query']): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (typeof query.requestId === 'string' && query.requestId) where.requestId = query.requestId;
  if (typeof query.userId === 'string' && query.userId) where.userId = query.userId;
  if (typeof query.action === 'string' && query.action) where.action = query.action;

  const createdAt: Prisma.DateTimeFilter = {};
  if (typeof query.from === 'string' && query.from) {
    const from = new Date(query.from);
    if (!isNaN(from.getTime())) createdAt.gte = from;
  }
  if (typeof query.to === 'string' && query.to) {
    const to = new Date(query.to);
    if (!isNaN(to.getTime())) createdAt.lte = to;
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  return where;
}

/**
 * Global audit trail — restricted to ADMIN/DIRETOR (least-privilege, LGPD).
 * The per-request timeline remains available to involved users via
 * GET /api/requests/:id (which embeds `auditLogs`).
 *
 * Filters: requestId, userId, action, from, to (ISO dates), limit.
 */
router.get('/', authenticate, requireRole('ADMIN'), async (req: ExpressRequest, res: Response) => {
  try {
    const take = Math.min(Number(req.query.limit) || 200, 1000);
    const logs = await prisma.auditLog.findMany({
      where: buildWhere(req.query),
      include: { request: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json(logs);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar trilha de auditoria' });
  }
});

/** Distinct action types present in the trail, for filter dropdowns. */
router.get('/actions', authenticate, requireRole('ADMIN'), async (_req: ExpressRequest, res: Response) => {
  try {
    const rows = await prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
    res.json(rows.map((r) => r.action));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar ações' });
  }
});

/**
 * Excel (.xlsx) export of the audit trail, honoring the same filters as the
 * listing. Restricted to ADMIN/DIRETOR. The file is streamed to the response —
 * it is a download, never an external transmission.
 */
router.get('/export', authenticate, requireRole('ADMIN'), async (req: ExpressRequest, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: buildWhere(req.query),
      include: { request: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 10000, 50000),
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'APROVA';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Auditoria');
    sheet.columns = [
      { header: 'Data/Hora', key: 'createdAt', width: 22 },
      { header: 'Solicitação', key: 'title', width: 40 },
      { header: 'ID Solicitação', key: 'requestId', width: 28 },
      { header: 'Usuário', key: 'userName', width: 26 },
      { header: 'Ação', key: 'action', width: 18 },
      { header: 'Detalhes', key: 'details', width: 60 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const log of logs) {
      sheet.addRow({
        createdAt: log.createdAt,
        title: log.request?.title ?? '',
        requestId: log.requestId,
        userName: log.userName,
        action: log.action,
        details: log.details ?? '',
      });
    }
    sheet.getColumn('createdAt').numFmt = 'dd/mm/yyyy hh:mm:ss';

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="auditoria-aprova-${stamp}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch {
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao exportar auditoria' });
  }
});

export default router;
