import { describe, it, expect } from 'vitest';
import {
  isTenantIsolationMessage,
  parseTenantIsolationMessage,
  TENANT_ISOLATION_PUBLIC_MESSAGE,
} from '@/lib/trpc/tenant-isolation-error';
import { friendlyTrpcError } from '@/lib/trpc/error-format';

describe('parseTenantIsolationMessage', () => {
  it('reconhece Error crua do backstop com tenantId ausente (create)', () => {
    const msg = '[tenant-isolation] Opportunity.create sem tenantId no payload';
    expect(isTenantIsolationMessage(msg)).toBe(true);
    expect(parseTenantIsolationMessage(msg)).toEqual({
      model: 'Opportunity',
      op: 'create',
      reason: 'missing_tenant_id',
    });
  });

  it('reconhece Error crua com tenantId ≠ contexto (update)', () => {
    const msg =
      '[tenant-isolation] Company.update tenantId no payload difere do contexto';
    expect(parseTenantIsolationMessage(msg)).toEqual({
      model: 'Company',
      op: 'update',
      reason: 'tenant_id_mismatch',
    });
  });

  it('reconhece variação com createMany', () => {
    const msg =
      '[tenant-isolation] Contact.createMany tenantId no payload difere do contexto';
    expect(parseTenantIsolationMessage(msg)).toEqual({
      model: 'Contact',
      op: 'createMany',
      reason: 'tenant_id_mismatch',
    });
  });

  it('retorna null para mensagem sem prefixo', () => {
    expect(parseTenantIsolationMessage('Erro genérico')).toBeNull();
    expect(isTenantIsolationMessage('Erro genérico')).toBe(false);
  });

  it('retorna null para mensagem com prefixo mas sem model.op parseável', () => {
    expect(parseTenantIsolationMessage('[tenant-isolation] hello world')).toBeNull();
    expect(parseTenantIsolationMessage('[tenant-isolation]')).toBeNull();
  });

  it('retorna null para tail desconhecido (evita falsos positivos)', () => {
    const msg = '[tenant-isolation] Opportunity.update alguma nova causa';
    expect(parseTenantIsolationMessage(msg)).toBeNull();
  });

  it('retorna null para tipos não-string', () => {
    expect(parseTenantIsolationMessage(undefined)).toBeNull();
    expect(parseTenantIsolationMessage(null)).toBeNull();
    expect(parseTenantIsolationMessage(123)).toBeNull();
    expect(parseTenantIsolationMessage({ message: 'x' })).toBeNull();
  });

  it('mensagem pública é constante estável', () => {
    expect(TENANT_ISOLATION_PUBLIC_MESSAGE).toMatch(/isolamento de dados/i);
  });
});

describe('friendlyTrpcError — tenantIsolation', () => {
  it('renderiza mensagem legível com modelo + operação', () => {
    const err = {
      message: TENANT_ISOLATION_PUBLIC_MESSAGE,
      data: {
        zodError: null,
        tenantIsolation: {
          model: 'Opportunity',
          op: 'update',
          reason: 'tenant_id_mismatch' as const,
        },
      },
    };
    expect(friendlyTrpcError(err)).toBe(
      'Erro de isolamento de dados. Reporte à equipe (modelo: Opportunity, operação: update).',
    );
  });

  it('precedence: tenantIsolation vence zodError se ambos presentes', () => {
    const err = {
      message: 'ignored',
      data: {
        zodError: { fieldErrors: { name: ['Muito curto'] }, formErrors: [] },
        tenantIsolation: {
          model: 'Contact',
          op: 'create',
          reason: 'missing_tenant_id' as const,
        },
      },
    };
    expect(friendlyTrpcError(err)).toContain('modelo: Contact');
    expect(friendlyTrpcError(err)).toContain('operação: create');
  });

  it('cai no fluxo zodError quando tenantIsolation é null', () => {
    const err = {
      message: 'stringified json',
      data: {
        zodError: { fieldErrors: { email: ['E-mail inválido'] }, formErrors: [] },
        tenantIsolation: null,
      },
    };
    expect(friendlyTrpcError(err)).toBe('E-mail inválido');
  });

  it('cai em err.message quando tenantIsolation é undefined (compat pré-P-46)', () => {
    const err = {
      message: 'Mensagem legada',
      data: { zodError: null },
    };
    expect(friendlyTrpcError(err)).toBe('Mensagem legada');
  });
});

describe('errorFormatter — integração com tRPC', () => {
  // Simula o shape retornado pelo errorFormatter. Não subimos o servidor
  // porque queremos isolar a lógica de detecção — o "shape" input aqui
  // é o mesmo que initTRPC entrega ao callback.
  //
  // O errorFormatter real vive em src/server/trpc/trpc.ts (função anônima
  // no initTRPC.create). Replicamos aqui pra testar puro:
  function replayErrorFormatter(input: {
    shape: {
      message: string;
      code: number;
      data: { code: string; httpStatus: number };
    };
    error: { message: string; cause?: unknown };
  }) {
    const { shape, error } = input;
    let tenantIsolation = null;
    if (error.cause instanceof Error) {
      tenantIsolation = parseTenantIsolationMessage(error.cause.message);
    }
    if (!tenantIsolation) {
      tenantIsolation = parseTenantIsolationMessage(error.message);
    }
    return {
      ...shape,
      message: tenantIsolation ? TENANT_ISOLATION_PUBLIC_MESSAGE : shape.message,
      data: {
        ...shape.data,
        zodError: null,
        tenantIsolation,
      },
    };
  }

  it('Error crua wrappada por mapErrors → cause preserva mensagem original', () => {
    const originalError = new Error(
      '[tenant-isolation] Opportunity.update tenantId no payload difere do contexto',
    );
    const shape = replayErrorFormatter({
      shape: {
        message: TENANT_ISOLATION_PUBLIC_MESSAGE,
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
      },
      error: {
        message: TENANT_ISOLATION_PUBLIC_MESSAGE,
        cause: originalError,
      },
    });

    expect(shape.data.tenantIsolation).toEqual({
      model: 'Opportunity',
      op: 'update',
      reason: 'tenant_id_mismatch',
    });
    expect(shape.message).toBe(TENANT_ISOLATION_PUBLIC_MESSAGE);
  });

  it('fallback: Error crua não-wrappada (bypass do mapErrors) ainda é detectada', () => {
    const shape = replayErrorFormatter({
      shape: {
        message: '[tenant-isolation] Company.create sem tenantId no payload',
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
      },
      error: {
        message: '[tenant-isolation] Company.create sem tenantId no payload',
      },
    });

    expect(shape.data.tenantIsolation).toEqual({
      model: 'Company',
      op: 'create',
      reason: 'missing_tenant_id',
    });
    // Mensagem sanitizada mesmo sem middleware.
    expect(shape.message).toBe(TENANT_ISOLATION_PUBLIC_MESSAGE);
  });

  it('erro não-tenant-isolation: tenantIsolation=null, message preservada (compat)', () => {
    const shape = replayErrorFormatter({
      shape: {
        message: 'FORBIDDEN',
        code: -32003,
        data: { code: 'FORBIDDEN', httpStatus: 403 },
      },
      error: { message: 'FORBIDDEN' },
    });

    expect(shape.data.tenantIsolation).toBeNull();
    expect(shape.message).toBe('FORBIDDEN');
  });
});
