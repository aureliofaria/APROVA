// Cliente compartilhado do Microsoft Graph (client credentials).
//
// Extraído de services/notificationDispatcher.ts para ser reutilizado por
// qualquer capacidade nova baseada em Graph (ex.: sync de usuários). Mantém
// o MESMO padrão: token cacheado em memória, App Registration com client
// credentials (tenant/clientId/clientSecret em env — ver config.ts).
import { config } from '../config';

let _token: { value: string; exp: number } = { value: '', exp: 0 };

// Retorna um access token válido, renovando quando expirado (com margem de
// 60s). Cache em memória — um único processo, sem persistência necessária.
export async function getGraphToken(deps: { fetchFn?: typeof fetch } = {}): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch;
  if (_token.value && Date.now() < _token.exp - 60000) return _token.value;
  const url = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`Graph token HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in?: number };
  _token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return _token.value;
}

// Uso em testes: força a próxima chamada a buscar um token novo.
export function resetGraphTokenCache(): void {
  _token = { value: '', exp: 0 };
}

// Forma mínima do usuário retornado pelo Graph com o $select usado pelo sync.
export interface GraphUserRaw {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
  accountEnabled: boolean;
  assignedLicenses: { skuId: string }[];
  department: string | null;
  jobTitle: string | null;
}

const USERS_SELECT = 'id,displayName,mail,userPrincipalName,accountEnabled,assignedLicenses,department,jobTitle';

// Busca TODOS os usuários do tenant, seguindo @odata.nextLink até esgotar as
// páginas. DI-friendly: `fetchFn`/`token` injetáveis para testes sem rede.
export async function fetchAllGraphUsers(
  deps: { fetchFn?: typeof fetch; token?: string } = {}
): Promise<GraphUserRaw[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const token = deps.token ?? (await getGraphToken({ fetchFn }));
  const users: GraphUserRaw[] = [];
  let url: string | null = `https://graph.microsoft.com/v1.0/users?$select=${USERS_SELECT}&$top=999`;
  while (url) {
    const r = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Graph users HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { value: GraphUserRaw[]; '@odata.nextLink'?: string };
    users.push(...(j.value ?? []));
    url = j['@odata.nextLink'] ?? null;
  }
  return users;
}
