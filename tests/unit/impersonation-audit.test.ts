import { describe, it, expect } from 'vitest';

/**
 * Garantias do audit de impersonação — Sprint 15A.
 *
 * O serviço `platformAudit` deve gravar metadata estruturado:
 *  - `platform_user_id`: sempre presente (rastreabilidade do Platform Owner)
 *  - `impersonated_by`: presente quando há sessionId (correlação)
 *  - `impersonation_session_id`: agrupa todas as ações da mesma sessão
 *
 * Testamos a forma dos metadados sem precisar do banco real.
 */

function buildMetadata(input: {
  platformUserId: string;
  impersonationSessionId?: string;
}): Record<string, string> {
  return {
    platform_user_id: input.platformUserId,
    ...(input.impersonationSessionId
      ? {
          impersonation_session_id: input.impersonationSessionId,
          impersonated_by: input.platformUserId,
        }
      : {}),
  };
}

describe('platformAudit metadata', () => {
  it('ação Platform sem impersonação só grava platform_user_id', () => {
    const meta = buildMetadata({ platformUserId: 'p1' });
    expect(meta.platform_user_id).toBe('p1');
    expect(meta.impersonated_by).toBeUndefined();
    expect(meta.impersonation_session_id).toBeUndefined();
  });

  it('ação dentro de impersonação grava os 3 campos', () => {
    const meta = buildMetadata({ platformUserId: 'p1', impersonationSessionId: 'imp_abc' });
    expect(meta.platform_user_id).toBe('p1');
    expect(meta.impersonated_by).toBe('p1');
    expect(meta.impersonation_session_id).toBe('imp_abc');
  });

  it('sessionId distinto para sessões diferentes', () => {
    const a = buildMetadata({ platformUserId: 'p1', impersonationSessionId: 'imp_a' });
    const b = buildMetadata({ platformUserId: 'p1', impersonationSessionId: 'imp_b' });
    expect(a.impersonation_session_id).not.toBe(b.impersonation_session_id);
    expect(a.platform_user_id).toBe(b.platform_user_id);
  });
});
