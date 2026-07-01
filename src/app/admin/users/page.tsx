'use client';

import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { useId, useMemo, useState } from 'react';
import type { UserRole } from '@prisma/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { useTableSort, type SortKey } from '@/lib/hooks/useTableSort';

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Admin',
  DIRETOR_COMERCIAL: 'Diretor Comercial',
  DIRETOR_OPERACOES: 'Diretor de Operações',
  DIRETOR_FINANCEIRO: 'Diretor Financeiro',
  GESTOR: 'Gestor',
  ANALISTA: 'Analista',
  PARCEIRO: 'Parceiro',
};

const ALL_ROLES: UserRole[] = [
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'ANALISTA',
  'PARCEIRO',
];

type UserRow = RouterOutputs['users']['list'][number];

const SORT_USER_NAME: SortKey<UserRow> = 'fullName';
const SORT_USER_EMAIL: SortKey<UserRow> = 'email';
const SORT_USER_ROLE: SortKey<UserRow> = (u) => ROLE_LABEL[u.role];
const SORT_USER_LAST_LOGIN: SortKey<UserRow> = (u) =>
  u.lastLoginAt ? new Date(u.lastLoginAt) : null;
const SORT_USER_STATUS: SortKey<UserRow> = 'active';

export default function AdminUsersPage() {
  const utils = trpc.useUtils();
  const me = trpc.users.me.useQuery();
  const list = trpc.users.list.useQuery({});
  const currentTenant = trpc.tenants.current.useQuery();
  const invite = trpc.users.invite.useMutation({
    onSuccess: () => {
      utils.users.list.invalidate();
      setShowInvite(false);
      setInviteForm({ email: '', fullName: '', role: 'ANALISTA' });
      setInviteError(null);
    },
    onError: (e) => setInviteError(friendlyTrpcError(e)),
  });
  const updateRole = trpc.users.updateRole.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });
  const deactivate = trpc.users.deactivate.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });

  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<{
    email: string;
    fullName: string;
    role: UserRole;
  }>({ email: '', fullName: '', role: 'ANALISTA' });
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Platform Owner é gerenciado em /platform/admins (Sprint 15A) — não
  // aparece nesta tela. Aqui todos os roles tenant-side são atribuíveis.
  const assignableRoles = ALL_ROLES;

  const inviteTitleId = useId();
  const tableCaptionId = useId();

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { sorted, toggleSort, getSortState } = useTableSort<UserRow>(rows);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Usuários"
        description="Gerencie acesso, papéis e status da equipe."
        primaryAction={
          <Button variant="primary" onClick={() => setShowInvite(true)}>
            + Convidar usuário
          </Button>
        }
      />

      {showInvite && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={inviteTitleId}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="bg-card rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 id={inviteTitleId} className="text-lg font-semibold">
              Convidar usuário
            </h2>
            {currentTenant.isLoading ? (
              <p className="text-sm text-text-3" aria-live="polite">
                Carregando tenant destino…
              </p>
            ) : currentTenant.data ? (
              <p className="text-sm text-text-2">
                Convidando para o tenant:{' '}
                <strong className="text-text-1">{currentTenant.data.name}</strong>
                {currentTenant.data.impersonating && (
                  <span className="ml-2 rounded bg-warning-bg px-2 py-0.5 text-xs text-warning-text">
                    ⚠ Modo impersonação — confirme o destino
                  </span>
                )}
              </p>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setInviteError(null);
                invite.mutate(inviteForm);
              }}
              className="space-y-3"
              noValidate
            >
              <InviteField label="Nome completo" required>
                <input
                  required
                  value={inviteForm.fullName}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, fullName: e.target.value }))
                  }
                  className="input"
                />
              </InviteField>
              <InviteField label="E-mail" required>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="input"
                />
              </InviteField>
              <InviteField label="Papel" required>
                <select
                  value={inviteForm.role}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, role: e.target.value as UserRole }))
                  }
                  className="input"
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </InviteField>
              {inviteError && (
                <p role="alert" className="text-sm text-danger">
                  {inviteError}
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowInvite(false)}
                  className="px-3 py-2 text-sm border rounded-md hover:bg-page"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={invite.isPending}
                  className="px-3 py-2 text-sm rounded-md bg-brand text-white hover:opacity-90 disabled:opacity-50"
                >
                  {invite.isPending ? 'Enviando...' : 'Enviar convite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section aria-labelledby={tableCaptionId}>
        <Table>
          <caption id={tableCaptionId} className="sr-only">
            Usuários cadastrados, com papel, último acesso e ações disponíveis
          </caption>
          <THead>
            <tr>
              <TH sortable sortState={getSortState(SORT_USER_NAME)} onSort={() => toggleSort(SORT_USER_NAME)}>
                Nome
              </TH>
              <TH sortable sortState={getSortState(SORT_USER_EMAIL)} onSort={() => toggleSort(SORT_USER_EMAIL)}>
                E-mail
              </TH>
              <TH sortable sortState={getSortState(SORT_USER_ROLE)} onSort={() => toggleSort(SORT_USER_ROLE)}>
                Papel
              </TH>
              <TH sortable sortState={getSortState(SORT_USER_LAST_LOGIN)} onSort={() => toggleSort(SORT_USER_LAST_LOGIN)}>
                Último login
              </TH>
              <TH sortable sortState={getSortState(SORT_USER_STATUS)} onSort={() => toggleSort(SORT_USER_STATUS)}>
                Status
              </TH>
              <TH className="text-right">Ações</TH>
            </tr>
          </THead>
          <TBody>
            {list.isLoading && (
              <TableEmpty colSpan={6}>Carregando...</TableEmpty>
            )}
            {sorted.map((u) => {
              const canEditThisUser = true;
              return (
                <TR key={u.id}>
                  <TD className="font-medium">{u.fullName}</TD>
                  <TD className="text-text-2">{u.email}</TD>
                  <TD>
                    <label className="sr-only" htmlFor={`role-${u.id}`}>
                      Papel de {u.fullName}
                    </label>
                    <select
                      id={`role-${u.id}`}
                      value={u.role}
                      disabled={!canEditThisUser || updateRole.isPending}
                      onChange={(e) =>
                        updateRole.mutate({
                          id: u.id,
                          role: e.target.value as UserRole,
                        })
                      }
                      className="border rounded px-2 py-1 text-xs bg-card focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </TD>
                  <TD className="text-text-2 text-xs">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString('pt-BR')
                      : 'Nunca'}
                  </TD>
                  <TD>
                    {u.active ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success-bg text-success-text">
                        Ativo
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-hover text-text-1">
                        Convidado / Inativo
                      </span>
                    )}
                  </TD>
                  <TD className="text-right">
                    {u.id !== me.data?.id && canEditThisUser && (
                      <button
                        onClick={() => {
                          if (confirm(`Desativar ${u.fullName}?`))
                            deactivate.mutate({ id: u.id });
                        }}
                        className="px-2 py-1 text-xs rounded border text-danger hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-rose-500"
                      >
                        Desativar
                      </button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </section>

      <style jsx>{`
        .input {
          width: 100%;
          border: 1px solid rgb(229 229 229);
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: 2px solid var(--brand-primary, #7c3aed);
          outline-offset: 1px;
        }
      `}</style>
    </div>
  );
}

function InviteField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const child = children as React.ReactElement;
  const withId = {
    ...child,
    props: { ...child.props, id, 'aria-required': required ? 'true' : undefined },
  } as React.ReactElement;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-text-1 block">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">*</span>
        )}
      </label>
      <div className="mt-1">{withId}</div>
    </div>
  );
}
