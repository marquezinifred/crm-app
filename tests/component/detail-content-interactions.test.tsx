import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Housekeeping (P-96 chip) — cobertura de FUNÇÕES nos componentes de
 * detalhe. O P-95 cobriu só render + error path (funcs 7–11%). Aqui
 * exercitamos as interações: troca de tabs, modal de edição, fluxo de
 * desativação (confirmar/cancelar) e os handlers das mutations.
 *
 * Complementa `detail-error-friendly.test.tsx` (P-95, error paths).
 * Padrão de mocks: `admin-users-actions.test.tsx` (P-86) — mocka
 * `@/lib/trpc/client` capturando `onSuccess`/`onError`, `ToastProvider`
 * real, `CompanyForm` stubado (é testado à parte e traz cascata de
 * queries própria).
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

interface CompanyData {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  type: string;
  country: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactRow {
  id: string;
  fullName: string;
  position: string | null;
  email: string;
}

interface ContactData {
  id: string;
  fullName: string;
  position: string | null;
  email: string;
  phone: string | null;
  relationshipType: string;
  workArea: string | null;
  seniority: string | null;
  function: string | null;
  specialty: string | null;
  notes: string | null;
  importantDates: {
    id: string;
    label: string | null;
    dateType: string;
    dateValue: Date;
    alertActive: boolean;
  }[];
  createdAt: Date;
}

const state: {
  company: CompanyData | undefined;
  companyContacts: { rows: ContactRow[]; total: number };
  contact: ContactData | undefined;
} = {
  company: undefined,
  companyContacts: { rows: [], total: 0 },
  contact: undefined,
};

const captured: {
  companyRemove: MutationOpts | null;
  contactRemove: MutationOpts | null;
  mutate: {
    companyRemove: ReturnType<typeof vi.fn>;
    contactRemove: ReturnType<typeof vi.fn>;
  };
  invalidates: {
    companiesList: ReturnType<typeof vi.fn>;
    companiesById: ReturnType<typeof vi.fn>;
    contactsList: ReturnType<typeof vi.fn>;
  };
} = {
  companyRemove: null,
  contactRemove: null,
  mutate: {
    companyRemove: vi.fn(),
    contactRemove: vi.fn(),
  },
  invalidates: {
    companiesList: vi.fn(),
    companiesById: vi.fn(),
    contactsList: vi.fn(),
  },
};

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// CompanyForm tem cascata própria de queries (territories/segments/
// industries/IBGE) + é coberto em company-form.test — aqui só verificamos
// que o modal de edição abre e faz o wiring de onSuccess/onCancel.
vi.mock('@/components/companies/CompanyForm', () => ({
  CompanyForm: ({
    onSuccess,
    onCancel,
  }: {
    onSuccess: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="company-form-stub">
      <button type="button" onClick={onCancel}>
        form-cancel
      </button>
      <button type="button" onClick={() => onSuccess()}>
        form-success
      </button>
    </div>
  ),
}));

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = <T,>(data: T) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({
        companies: {
          list: { invalidate: captured.invalidates.companiesList },
          byId: { invalidate: captured.invalidates.companiesById },
        },
        contacts: {
          list: { invalidate: captured.invalidates.contactsList },
        },
      }),
      companies: {
        byId: {
          useQuery: () => queryReturn(state.company),
        },
        remove: {
          useMutation: (opts: MutationOpts) => {
            captured.companyRemove = opts;
            return {
              mutate: captured.mutate.companyRemove,
              isPending: false,
              error: null,
            };
          },
        },
      },
      contacts: {
        byId: {
          useQuery: () => queryReturn(state.contact),
        },
        list: {
          useQuery: () => queryReturn(state.companyContacts),
        },
        remove: {
          useMutation: (opts: MutationOpts) => {
            captured.contactRemove = opts;
            return {
              mutate: captured.mutate.contactRemove,
              isPending: false,
              error: null,
            };
          },
        },
      },
    },
  };
});

import { CompanyDetailContent } from '@/components/companies/CompanyDetailContent';
import { ContactDetailContent } from '@/components/contacts/ContactDetailContent';
import { ToastProvider } from '@/components/ui/toast';

const CREATED = new Date('2026-01-10T12:00:00Z');
const UPDATED = new Date('2026-06-20T12:00:00Z');

function renderCompany() {
  return render(
    <ToastProvider>
      <CompanyDetailContent companyId="cmp-1" />
    </ToastProvider>,
  );
}

function renderContact() {
  return render(
    <ToastProvider>
      <ContactDetailContent contactId="ct-1" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  state.company = {
    id: 'cmp-1',
    razaoSocial: 'Marquezini Comércio LTDA',
    nomeFantasia: 'Marquezini',
    type: 'CLIENT',
    country: 'BR',
    cnpj: '12345678000199',
    city: 'São Paulo',
    state: 'SP',
    phone: '+55 11 99999-0000',
    email: 'contato@marquezini.com',
    website: 'https://marquezini.com',
    notes: 'Cliente âncora da região sul.',
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
  state.companyContacts = {
    rows: [
      { id: 'ct-9', fullName: 'Joana Prado', position: 'Compras', email: 'joana@marquezini.com' },
    ],
    total: 1,
  };
  state.contact = {
    id: 'ct-1',
    fullName: 'Carlos Nunes',
    position: 'Gerente de TI',
    email: 'carlos@acme.com',
    phone: '+55 21 98888-7777',
    relationshipType: 'CLIENTE',
    workArea: 'COMERCIAL',
    seniority: 'SENIOR',
    function: 'Decisor técnico',
    specialty: 'Infraestrutura',
    notes: 'Prefere contato por e-mail.',
    importantDates: [
      {
        id: 'd-1',
        label: 'Aniversário',
        dateType: 'BIRTHDAY',
        dateValue: new Date('2026-09-01T00:00:00Z'),
        alertActive: true,
      },
    ],
    createdAt: CREATED,
  };
  captured.companyRemove = null;
  captured.contactRemove = null;
  captured.mutate.companyRemove = vi.fn();
  captured.mutate.contactRemove = vi.fn();
  captured.invalidates.companiesList = vi.fn();
  captured.invalidates.companiesById = vi.fn();
  captured.invalidates.contactsList = vi.fn();
});

describe('CompanyDetailContent — interações (housekeeping)', () => {
  it('renderiza overview com nome, CNPJ formatado e badges', () => {
    renderCompany();
    expect(
      screen.getByRole('heading', { level: 2, name: /Marquezini/i }),
    ).toBeInTheDocument();
    // razão social como caption
    expect(screen.getByText(/Marquezini Comércio LTDA/i)).toBeInTheDocument();
    // CNPJ formatado por formatCnpj (não os 14 dígitos crus)
    expect(screen.getByText('12.345.678/0001-99')).toBeInTheDocument();
    expect(screen.queryByText('12345678000199')).not.toBeInTheDocument();
    // localização, badge de tipo
    expect(screen.getByText('São Paulo / SP')).toBeInTheDocument();
    expect(screen.getByText('CLIENT')).toBeInTheDocument();
  });

  it('troca para a aba Contatos e mostra contatos vinculados', async () => {
    const user = userEvent.setup();
    renderCompany();
    await user.click(screen.getByRole('tab', { name: /Contatos/i }));
    await waitFor(() => {
      expect(screen.getByText(/Contatos vinculados/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Joana Prado')).toBeInTheDocument();
  });

  it('troca para a aba Histórico e mostra a data de cadastro', async () => {
    const user = userEvent.setup();
    renderCompany();
    await user.click(screen.getByRole('tab', { name: /Histórico/i }));
    await waitFor(() => {
      expect(screen.getByText(/Cadastrada em/i)).toBeInTheDocument();
    });
    // updatedAt != createdAt → mostra "Última atualização"
    expect(screen.getByText(/Última atualização/i)).toBeInTheDocument();
  });

  it('clicar em Editar abre o modal de edição com o CompanyForm', async () => {
    const user = userEvent.setup();
    renderCompany();
    await user.click(screen.getByRole('button', { name: /^Editar$/i }));
    const dialog = await screen.findByRole('dialog', { name: /Editar empresa/i });
    expect(within(dialog).getByTestId('company-form-stub')).toBeInTheDocument();
  });

  it('onSuccess do CompanyForm fecha o modal e invalida byId', async () => {
    const user = userEvent.setup();
    renderCompany();
    await user.click(screen.getByRole('button', { name: /^Editar$/i }));
    const dialog = await screen.findByRole('dialog', { name: /Editar empresa/i });
    await user.click(within(dialog).getByRole('button', { name: /form-success/i }));

    expect(captured.invalidates.companiesById).toHaveBeenCalledWith({ id: 'cmp-1' });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Editar empresa/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('Desativar empresa abre AlertDialog; confirmar dispara remove com id', async () => {
    const user = userEvent.setup();
    renderCompany();
    await user.click(screen.getByRole('button', { name: /Desativar empresa/i }));
    const dialog = await screen.findByRole('dialog', { name: /Desativar empresa\?/i });
    expect(captured.mutate.companyRemove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /^Desativar$/i }));
    expect(captured.mutate.companyRemove).toHaveBeenCalledWith({ id: 'cmp-1' });
  });

  it('cancelar no modal de desativação NÃO dispara remove', async () => {
    const user = userEvent.setup();
    renderCompany();
    await user.click(screen.getByRole('button', { name: /Desativar empresa/i }));
    const dialog = await screen.findByRole('dialog', { name: /Desativar empresa\?/i });
    await user.click(within(dialog).getByRole('button', { name: /Cancelar/i }));

    expect(captured.mutate.companyRemove).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Desativar empresa\?/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('remove onSuccess dispara toast + invalida list', async () => {
    renderCompany();
    expect(captured.companyRemove?.onSuccess).toBeTypeOf('function');
    await act(async () => {
      captured.companyRemove!.onSuccess!();
    });
    await waitFor(() => {
      expect(screen.getByText(/Empresa desativada\./i)).toBeInTheDocument();
    });
    expect(captured.invalidates.companiesList).toHaveBeenCalled();
  });

  it('remove onError dispara toast com friendlyTrpcError', async () => {
    renderCompany();
    expect(captured.companyRemove?.onError).toBeTypeOf('function');
    await act(async () => {
      captured.companyRemove!.onError!({ message: 'Empresa com contratos ativos.' });
    });
    await waitFor(() => {
      expect(screen.getByText(/Empresa com contratos ativos/i)).toBeInTheDocument();
    });
  });
});

describe('ContactDetailContent — interações (housekeeping)', () => {
  it('renderiza overview com nome, cargo/email e badge de relacionamento', () => {
    renderContact();
    expect(
      screen.getByRole('heading', { level: 2, name: /Carlos Nunes/i }),
    ).toBeInTheDocument();
    // Cargo aparece no header e no Item "Cargo" da overview
    expect(screen.getAllByText(/Gerente de TI/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    // E-mail aparece no header e no Item "E-mail"
    expect(screen.getAllByText('carlos@acme.com').length).toBeGreaterThan(0);
  });

  it('troca para a aba Datas e mostra a data importante', async () => {
    const user = userEvent.setup();
    renderContact();
    await user.click(screen.getByRole('tab', { name: /Datas/i }));
    await waitFor(() => {
      expect(screen.getByText('Aniversário')).toBeInTheDocument();
    });
    expect(screen.getByText(/Alerta on/i)).toBeInTheDocument();
  });

  it('troca para a aba Histórico e mostra a data de cadastro', async () => {
    const user = userEvent.setup();
    renderContact();
    await user.click(screen.getByRole('tab', { name: /Histórico/i }));
    await waitFor(() => {
      expect(screen.getByText(/Cadastrado em/i)).toBeInTheDocument();
    });
  });

  it('Desativar contato abre AlertDialog; confirmar dispara remove com id', async () => {
    const user = userEvent.setup();
    renderContact();
    await user.click(screen.getByRole('button', { name: /Desativar contato/i }));
    const dialog = await screen.findByRole('dialog', { name: /Desativar contato\?/i });
    expect(captured.mutate.contactRemove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /^Desativar$/i }));
    expect(captured.mutate.contactRemove).toHaveBeenCalledWith({ id: 'ct-1' });
  });

  it('cancelar no modal de desativação NÃO dispara remove', async () => {
    const user = userEvent.setup();
    renderContact();
    await user.click(screen.getByRole('button', { name: /Desativar contato/i }));
    const dialog = await screen.findByRole('dialog', { name: /Desativar contato\?/i });
    await user.click(within(dialog).getByRole('button', { name: /Cancelar/i }));

    expect(captured.mutate.contactRemove).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Desativar contato\?/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('remove onSuccess dispara toast + invalida list', async () => {
    renderContact();
    expect(captured.contactRemove?.onSuccess).toBeTypeOf('function');
    await act(async () => {
      captured.contactRemove!.onSuccess!();
    });
    await waitFor(() => {
      expect(screen.getByText(/Contato desativado\./i)).toBeInTheDocument();
    });
    expect(captured.invalidates.contactsList).toHaveBeenCalled();
  });

  it('remove onError dispara toast com friendlyTrpcError', async () => {
    renderContact();
    expect(captured.contactRemove?.onError).toBeTypeOf('function');
    await act(async () => {
      captured.contactRemove!.onError!({ message: 'Contato vinculado a oportunidade.' });
    });
    await waitFor(() => {
      expect(screen.getByText(/Contato vinculado a oportunidade/i)).toBeInTheDocument();
    });
  });
});
