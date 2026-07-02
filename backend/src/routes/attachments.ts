import { Router, Response } from 'express';
import fs from 'fs';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { canViewRequest } from '../lib/visibility';

const router = Router();

// Download autenticado de um anexo — substitui o antigo `app.use('/uploads',
// express.static(...))`, que servia qualquer arquivo a QUALQUER pessoa com a
// URL (nem exigia login). Aqui: exige token válido e o MESMO predicado de
// visibilidade do GET /requests/:id (lib/visibility::canViewRequest) — só quem
// tem vínculo com a solicitação (iniciador, responsável por alguma tarefa,
// aprovador, ou escopo de setor/hierarquia) baixa o arquivo.
//
// Oráculo de existência (Fix 3): 404 tanto quando o anexo não existe quanto
// quando existe mas o usuário não tem vínculo — nunca revela qual dos dois é
// o caso a quem não deveria nem saber que o anexo existe.
router.get('/:id/download', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
      include: {
        request: {
          include: {
            tasks: { select: { assigneeId: true } },
            approvals: { select: { approverId: true } },
          },
        },
      },
    });
    // Sem requestId (órfão) ou solicitação removida: não há como avaliar o
    // vínculo — trata como não encontrado.
    if (!attachment || !attachment.request) {
      res.status(404).json({ error: 'Anexo não encontrado' });
      return;
    }
    if (!(await canViewRequest(req.user, attachment.request))) {
      res.status(404).json({ error: 'Anexo não encontrado' });
      return;
    }
    if (!fs.existsSync(attachment.storagePath)) {
      res.status(404).json({ error: 'Anexo não encontrado' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(attachment.storagePath, attachment.originalName);
  } catch {
    res.status(500).json({ error: 'Erro ao baixar anexo' });
  }
});

export default router;
