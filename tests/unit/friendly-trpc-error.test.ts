import { describe, it, expect } from 'vitest';
import { friendlyTrpcError } from '@/lib/trpc/error-format';

describe('friendlyTrpcError', () => {
  it('extrai primeira mensagem de fieldErrors quando há um único campo', () => {
    const err = {
      message: '[{"code":"custom","message":"E-mail inválido","path":["email"]}]',
      data: { zodError: { fieldErrors: { email: ['E-mail inválido'] }, formErrors: [] } },
    };
    expect(friendlyTrpcError(err)).toBe('E-mail inválido');
  });

  it('extrai primeira mensagem quando múltiplos campos têm erro', () => {
    const err = {
      message: 'stringified json',
      data: {
        zodError: {
          fieldErrors: {
            name: ['Muito curto'],
            age: ['Deve ser >18'],
          },
          formErrors: [],
        },
      },
    };
    const result = friendlyTrpcError(err);
    expect(['Muito curto', 'Deve ser >18']).toContain(result);
  });

  it('cai em formErrors quando fieldErrors está vazio', () => {
    const err = {
      message: 'stringified json',
      data: {
        zodError: {
          fieldErrors: {},
          formErrors: ['Erro geral'],
        },
      },
    };
    expect(friendlyTrpcError(err)).toBe('Erro geral');
  });

  it('retorna err.message quando não é erro Zod', () => {
    const err = {
      message: 'Acesso restrito a Platform Owners.',
      data: { zodError: null },
    };
    expect(friendlyTrpcError(err)).toBe('Acesso restrito a Platform Owners.');
  });

  it('retorna err.message quando não há campo data', () => {
    const err = { message: 'Erro sem shape estruturado' };
    expect(friendlyTrpcError(err)).toBe('Erro sem shape estruturado');
  });

  it('cai no fallback quando fieldErrors e formErrors estão vazios', () => {
    const err = {
      message: 'fallback message',
      data: { zodError: { fieldErrors: {}, formErrors: [] } },
    };
    expect(friendlyTrpcError(err)).toBe('fallback message');
  });

  it('ignora arrays de fieldErrors vazias e busca próxima com conteúdo', () => {
    const err = {
      message: 'fallback',
      data: {
        zodError: {
          fieldErrors: {
            first: [],
            second: ['Erro real'],
          },
          formErrors: [],
        },
      },
    };
    expect(friendlyTrpcError(err)).toBe('Erro real');
  });

  it('ignora strings vazias dentro de fieldErrors', () => {
    const err = {
      message: 'fallback',
      data: {
        zodError: {
          fieldErrors: {
            email: ['', 'E-mail inválido'],
          },
          formErrors: [],
        },
      },
    };
    expect(friendlyTrpcError(err)).toBe('E-mail inválido');
  });
});
