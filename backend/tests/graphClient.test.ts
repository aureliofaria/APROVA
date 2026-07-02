import { describe, expect, it } from 'vitest';
import { fetchAllGraphUsers } from '../src/lib/graphClient';

// fetchFn mockado — sem rede, sem token real (token passado direto via deps).
type FakeResponse = { ok: boolean; status?: number; json: () => Promise<any>; text: () => Promise<string> };

describe('graphClient · fetchAllGraphUsers (paginação)', () => {
  it('segue @odata.nextLink até esgotar as páginas e concatena os resultados', async () => {
    const page1 = {
      value: [{ id: '1', mail: 'a@golplus.com.br', accountEnabled: true, assignedLicenses: [] }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=page2',
    };
    const page2 = {
      value: [{ id: '2', mail: 'b@golplus.com.br', accountEnabled: true, assignedLicenses: [] }],
    };
    const calls: string[] = [];
    const fetchFn = (async (url: string): Promise<FakeResponse> => {
      calls.push(url);
      const body = url.includes('skiptoken') ? page2 : page1;
      return { ok: true, json: async () => body, text: async () => '' };
    }) as unknown as typeof fetch;

    const users = await fetchAllGraphUsers({ fetchFn, token: 'fake-token' });
    expect(calls).toHaveLength(2);
    expect(users.map((u) => u.id)).toEqual(['1', '2']);
  });

  it('para na primeira página quando não há @odata.nextLink', async () => {
    const fetchFn = (async () => ({
      ok: true,
      json: async () => ({ value: [{ id: 'x', mail: 'x@golplus.com.br', accountEnabled: true, assignedLicenses: [] }] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const users = await fetchAllGraphUsers({ fetchFn, token: 'fake-token' });
    expect(users).toHaveLength(1);
  });

  it('propaga erro HTTP com o status e corpo truncado', async () => {
    const fetchFn = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'tenant unavailable',
    })) as unknown as typeof fetch;

    await expect(fetchAllGraphUsers({ fetchFn, token: 'fake-token' })).rejects.toThrow(/Graph users HTTP 500/);
  });
});
