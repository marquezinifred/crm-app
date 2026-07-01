import { describe, it, expect } from 'vitest';
import { selectApplicableRules } from '@/server/services/approval-engine.service';
import type { ApprovalRuleCriteria, UserRole } from '@prisma/client';

/**
 * Sprint 15E — testes de compat dual (approverRoles OU approverPermission).
 * `selectApplicableRules` é função pura (sem Prisma); testes de integração
 * DB-side ficam em Phase 4 futuro.
 */

const rule = (overrides: Partial<{
  id: string;
  name: string;
  criteria: ApprovalRuleCriteria;
  thresholdNumeric: number | null;
  approverRoles: UserRole[];
  approverPermission: string | null;
  enabled: boolean;
}>) => ({
  id: overrides.id ?? '1',
  name: overrides.name ?? 'Rule',
  criteria: overrides.criteria ?? ('UNIVERSAL' as ApprovalRuleCriteria),
  thresholdNumeric: overrides.thresholdNumeric ?? null,
  approverRoles: (overrides.approverRoles ?? []) as UserRole[],
  approverPermission: overrides.approverPermission ?? null,
  enabled: overrides.enabled ?? true,
});

describe('selectApplicableRules — dual approver (Sprint 15E)', () => {
  it('rule com approverRoles preenchido preserva os roles (backward compat)', () => {
    const matches = selectApplicableRules(
      { totalValue: 100_000, marginPct: 20 },
      [rule({ criteria: 'UNIVERSAL', approverRoles: ['DIRETOR_COMERCIAL', 'DIRETOR_FINANCEIRO'] })],
    );
    expect(matches.length).toBe(1);
    expect(matches[0]!.approverRoles).toEqual(['DIRETOR_COMERCIAL', 'DIRETOR_FINANCEIRO']);
    expect(matches[0]!.approverPermission).toBeNull();
  });

  it('rule com approverPermission preenchido preserva a permission (novo caminho 15E)', () => {
    const matches = selectApplicableRules(
      { totalValue: 100_000, marginPct: 20 },
      [
        rule({
          criteria: 'TOTAL_VALUE_ABOVE',
          thresholdNumeric: 50_000,
          approverPermission: 'proposal:approve',
        }),
      ],
    );
    expect(matches.length).toBe(1);
    expect(matches[0]!.approverPermission).toBe('proposal:approve');
    expect(matches[0]!.approverRoles).toEqual([]);
  });

  it('rule com approverPermission + criteria TOTAL_VALUE_ABOVE aplica valor corretamente', () => {
    const matches = selectApplicableRules(
      { totalValue: 30_000, marginPct: 20 },
      [
        rule({
          criteria: 'TOTAL_VALUE_ABOVE',
          thresholdNumeric: 50_000,
          approverPermission: 'proposal:approve',
        }),
      ],
    );
    expect(matches.length).toBe(0); // abaixo do threshold
  });

  it('múltiplas rules — mix de approverRoles e approverPermission na mesma proposta', () => {
    const matches = selectApplicableRules(
      { totalValue: 100_000, marginPct: 10 },
      [
        rule({
          id: 'a',
          criteria: 'MIN_MARGIN_BELOW',
          thresholdNumeric: 15,
          approverRoles: ['DIRETOR_FINANCEIRO'],
        }),
        rule({
          id: 'b',
          criteria: 'TOTAL_VALUE_ABOVE',
          thresholdNumeric: 50_000,
          approverPermission: 'proposal:approve',
        }),
      ],
    );
    expect(matches.length).toBe(2);
    expect(matches.find((m) => m.ruleId === 'a')!.approverRoles).toEqual([
      'DIRETOR_FINANCEIRO',
    ]);
    expect(matches.find((m) => m.ruleId === 'b')!.approverPermission).toBe(
      'proposal:approve',
    );
  });
});
