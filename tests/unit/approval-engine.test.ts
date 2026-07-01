import { describe, it, expect } from 'vitest';
import { selectApplicableRules } from '@/server/services/approval-engine.service';
import type { ApprovalRuleCriteria, UserRole } from '@prisma/client';

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
  approverRoles: (overrides.approverRoles ?? ['DIRETOR_COMERCIAL']) as UserRole[],
  approverPermission: overrides.approverPermission ?? null,
  enabled: overrides.enabled ?? true,
});

describe('selectApplicableRules', () => {
  it('UNIVERSAL dispara sempre que enabled', () => {
    const r = selectApplicableRules(
      { totalValue: 1000, marginPct: 50 },
      [rule({ criteria: 'UNIVERSAL' })],
    );
    expect(r).toHaveLength(1);
  });

  it('UNIVERSAL disabled não dispara', () => {
    const r = selectApplicableRules(
      { totalValue: 1000, marginPct: 50 },
      [rule({ criteria: 'UNIVERSAL', enabled: false })],
    );
    expect(r).toHaveLength(0);
  });

  it('MIN_MARGIN_BELOW: dispara quando margin abaixo do threshold', () => {
    const r = selectApplicableRules(
      { totalValue: 1000, marginPct: 10 },
      [rule({ criteria: 'MIN_MARGIN_BELOW', thresholdNumeric: 15 })],
    );
    expect(r).toHaveLength(1);
  });

  it('MIN_MARGIN_BELOW: não dispara se margin igual ou acima', () => {
    const r = selectApplicableRules(
      { totalValue: 1000, marginPct: 15 },
      [rule({ criteria: 'MIN_MARGIN_BELOW', thresholdNumeric: 15 })],
    );
    expect(r).toHaveLength(0);
  });

  it('MIN_MARGIN_BELOW: não dispara se marginPct null', () => {
    const r = selectApplicableRules(
      { totalValue: 1000, marginPct: null },
      [rule({ criteria: 'MIN_MARGIN_BELOW', thresholdNumeric: 15 })],
    );
    expect(r).toHaveLength(0);
  });

  it('TOTAL_VALUE_ABOVE: dispara quando valor acima', () => {
    const r = selectApplicableRules(
      { totalValue: 600_000, marginPct: 20 },
      [rule({ criteria: 'TOTAL_VALUE_ABOVE', thresholdNumeric: 500_000 })],
    );
    expect(r).toHaveLength(1);
  });

  it('TOTAL_VALUE_ABOVE: não dispara se valor igual', () => {
    const r = selectApplicableRules(
      { totalValue: 500_000, marginPct: 20 },
      [rule({ criteria: 'TOTAL_VALUE_ABOVE', thresholdNumeric: 500_000 })],
    );
    expect(r).toHaveLength(0);
  });

  it('múltiplas regras: retorna todas que aplicam', () => {
    const r = selectApplicableRules(
      { totalValue: 600_000, marginPct: 10 },
      [
        rule({ id: 'a', criteria: 'MIN_MARGIN_BELOW', thresholdNumeric: 15 }),
        rule({ id: 'b', criteria: 'TOTAL_VALUE_ABOVE', thresholdNumeric: 500_000 }),
        rule({ id: 'c', criteria: 'MIN_MARGIN_BELOW', thresholdNumeric: 5 }),
      ],
    );
    expect(r.map((x) => x.ruleId).sort()).toEqual(['a', 'b']);
  });
});
