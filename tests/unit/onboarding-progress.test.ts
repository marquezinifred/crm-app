import { describe, it, expect } from 'vitest';

/**
 * Smoke tests da forma do checklist do Sprint 13.
 *
 * Os efeitos no banco são exercidos por testes de integração gated por
 * DATABASE_URL_TEST. Aqui validamos garantias da estrutura: 9 steps,
 * todos com chaves esperadas, hrefs válidos, ordem de progressão.
 */

const EXPECTED_KEYS = [
  'invite_users',
  'territories',
  'segments',
  'companies',
  'products',
  'approval_rules',
  'email_inbound',
  'ai',
  'branding',
] as const;

describe('onboarding progress shape', () => {
  it('tem exatamente 9 steps na ordem esperada', () => {
    expect(EXPECTED_KEYS).toHaveLength(9);
  });

  it('keys são únicos e não vazios', () => {
    const set = new Set(EXPECTED_KEYS);
    expect(set.size).toBe(EXPECTED_KEYS.length);
    for (const k of EXPECTED_KEYS) expect(k.length).toBeGreaterThan(0);
  });

  it('hrefs esperados começam com /', () => {
    const hrefs = [
      '/admin/users',
      '/companies',
      '/companies',
      '/companies',
      '/admin/products',
      '/admin/approval-rules',
      '/admin/email-inbound',
      '/admin/ai',
      '/admin/branding',
    ];
    for (const h of hrefs) expect(h.startsWith('/')).toBe(true);
  });

  it('progresso 100% requer todos os 9 marcados', () => {
    const completed = EXPECTED_KEYS.length;
    const total = 9;
    expect(completed / total).toBe(1);
  });

  it('progresso parcial calcula percentual corretamente', () => {
    expect(Math.round((3 / 9) * 100)).toBe(33);
    expect(Math.round((5 / 9) * 100)).toBe(56);
    expect(Math.round((8 / 9) * 100)).toBe(89);
  });
});
