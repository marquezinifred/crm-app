import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';

/**
 * Smoke do enforcement de Platform Owner — Sprint 15A.
 *
 * Replica a lógica do middleware tRPC `enforcePlatform` para validar
 * sem precisar bootear o app inteiro.
 */
function enforcePlatform(platformRole: string | null) {
  if (platformRole !== 'PLATFORM_OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acesso restrito a Platform Owners.' });
  }
}

describe('platformProcedure enforcement', () => {
  it('PLATFORM_OWNER passa', () => {
    expect(() => enforcePlatform('PLATFORM_OWNER')).not.toThrow();
  });
  it('tenant role ADMIN é bloqueado', () => {
    expect(() => enforcePlatform('ADMIN')).toThrow(TRPCError);
  });
  it('sem role é bloqueado', () => {
    expect(() => enforcePlatform(null)).toThrow(TRPCError);
  });
  it('PLATFORM_SUPPORT (futuro) é bloqueado por enquanto', () => {
    expect(() => enforcePlatform('PLATFORM_SUPPORT')).toThrow(TRPCError);
  });
});
