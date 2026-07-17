import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * P-95 — erros Zod/TRPC crus vazando nas rotas de operação.
 *
 * Reproduz o caso do print do Fred (2026-07-17): navegar pra
 * /companies/new (antes do P-94) caía em [id] com id="new" e o
 * CompanyDetailContent renderizava `companyQ.error.message` cru —
 * o array Zod `[{"validation":"uuid",...}]` em vermelho na tela.
 *
 * Cobre CompanyDetailContent e ContactDetailContent:
 *  1. erro Zod (uuid inválido) → mensagem amigável, sem JSON cru
 *  2. NOT_FOUND → "Empresa não encontrada." / "Contato não encontrado."
 *  3. erro genérico → ErrorState com botão "Tentar novamente"
 *
 * Padrão de mocks: tests/component/admin-users-actions.test.tsx (P-86).
 */

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

type QueryError = {
  message: string;
  data?: {
    code?: string;
    zodError?: {
      fieldErrors?: Record<string, string[] | undefined>;
      formErrors?: string[];
    } | null;
  } | null;
};

const state: {
  companyError: QueryError | null;
  contactError: QueryError | null;
} = { companyError: null, contactError: null };

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = (data: unknown, error: QueryError | null = null) => ({
    data,
    isLoading: false,
    isFetching: false,
    error,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({
        companies: { list: { invalidate: vi.fn() }, byId: { invalidate: vi.fn() } },
        contacts: { list: { invalidate: vi.fn() }, byId: { invalidate: vi.fn() } },
      }),
      companies: {
        byId: {
          useQuery: () => queryReturn(undefined, state.companyError),
        },
        remove: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
        },
      },
      contacts: {
        byId: {
          useQuery: () => queryReturn(undefined, state.contactError),
        },
        list: {
          useQuery: () => queryReturn({ rows: [], total: 0 }),
        },
        remove: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
        },
      },
    },
  };
});

import { CompanyDetailContent } from '@/components/companies/CompanyDetailContent';
import { ContactDetailContent } from '@/components/contacts/ContactDetailContent';
import { ToastProvider } from '@/components/ui/toast';

const RAW_ZOD_MESSAGE = JSON.stringify([
  { validation: 'uuid', code: 'invalid_string', message: 'Invalid uuid', path: ['id'] },
]);

const ZOD_UUID_ERROR: QueryError = {
  message: RAW_ZOD_MESSAGE,
  data: {
    code: 'BAD_REQUEST',
    zodError: { fieldErrors: { id: ['Invalid uuid'] }, formErrors: [] },
  },
};

const NOT_FOUND_ERROR: QueryError = {
  message: 'NOT_FOUND',
  data: { code: 'NOT_FOUND' },
};

const GENERIC_ERROR: QueryError = {
  message: 'Falha de rede ao consultar o servidor.',
  data: { code: 'INTERNAL_SERVER_ERROR' },
};

beforeEach(() => {
  state.companyError = null;
  state.contactError = null;
});

function renderCompany() {
  return render(
    <ToastProvider>
      <CompanyDetailContent companyId="new" />
    </ToastProvider>,
  );
}

function renderContact() {
  return render(
    <ToastProvider>
      <ContactDetailContent contactId="new" />
    </ToastProvider>,
  );
}

describe('CompanyDetailContent — erro de query (P-95)', () => {
  it('erro Zod (uuid inválido) renderiza mensagem amigável, sem JSON cru', () => {
    state.companyError = ZOD_UUID_ERROR;
    renderCompany();

    expect(screen.getByText(/Algo saiu errado\./i)).toBeInTheDocument();
    expect(screen.getByText(/Invalid uuid/i)).toBeInTheDocument();
    // O array Zod cru NUNCA aparece na tela
    expect(screen.queryByText(RAW_ZOD_MESSAGE)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('"validation"');
  });

  it('NOT_FOUND renderiza "Empresa não encontrada." sem botão de retry', () => {
    state.companyError = NOT_FOUND_ERROR;
    renderCompany();

    expect(screen.getByText(/Empresa não encontrada\./i)).toBeInTheDocument();
    // "NOT_FOUND" cru não vaza
    expect(screen.queryByText(/^NOT_FOUND$/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Tentar novamente/i }),
    ).not.toBeInTheDocument();
  });

  it('erro genérico renderiza ErrorState com "Tentar novamente"', () => {
    state.companyError = GENERIC_ERROR;
    renderCompany();

    expect(screen.getByText(/Algo saiu errado\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/Falha de rede ao consultar o servidor\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Tentar novamente/i }),
    ).toBeInTheDocument();
  });
});

describe('ContactDetailContent — erro de query (P-95)', () => {
  it('erro Zod (uuid inválido) renderiza mensagem amigável, sem JSON cru', () => {
    state.contactError = ZOD_UUID_ERROR;
    renderContact();

    expect(screen.getByText(/Algo saiu errado\./i)).toBeInTheDocument();
    expect(screen.getByText(/Invalid uuid/i)).toBeInTheDocument();
    expect(screen.queryByText(RAW_ZOD_MESSAGE)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('"validation"');
  });

  it('NOT_FOUND renderiza "Contato não encontrado."', () => {
    state.contactError = NOT_FOUND_ERROR;
    renderContact();

    expect(screen.getByText(/Contato não encontrado\./i)).toBeInTheDocument();
    expect(screen.queryByText(/^NOT_FOUND$/)).not.toBeInTheDocument();
  });
});
