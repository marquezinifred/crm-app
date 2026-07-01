'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import {
  Table,
  THead,
  TBody,
  TH,
  TR,
  TD,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table';
import { useTableSort, type SortKey } from '@/lib/hooks/useTableSort';
import type { TenantPlan } from '@prisma/client';

const PLAN_VARIANT: Record<TenantPlan, 'default' | 'primary' | 'success' | 'gold'> = {
  TRIAL: 'default',
  STARTER: 'primary',
  PRO: 'success',
  ENTERPRISE: 'gold',
};

type TenantRow = RouterOutputs['platform']['tenantsList'][number];

const SORT_T_NAME: SortKey<TenantRow> = 'name';
const SORT_T_PLAN: SortKey<TenantRow> = 'plan';
const SORT_T_STATUS: SortKey<TenantRow> = (t) => t.subscriptionStatus ?? null;
const SORT_T_USERS: SortKey<TenantRow> = (t) => t._count.users;
const SORT_T_OPPS: SortKey<TenantRow> = (t) => t._count.opportunities;
const SORT_T_CREATED: SortKey<TenantRow> = (t) => new Date(t.createdAt);

export default function PlatformTenantsPage() {
  const router = useRouter();
  const list = trpc.platform.tenantsList.useQuery({});
  const utils = trpc.useUtils();
  const create = trpc.platform.tenantCreate.useMutation({
    onSuccess: () => {
      utils.platform.tenantsList.invalidate();
      setCreateOpen(false);
    },
    onError: (e) => setCreateError(e.message),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { sorted, toggleSort, getSortState } = useTableSort<TenantRow>(rows);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    razaoSocial: '',
    cnpj: '',
    plan: 'TRIAL' as TenantPlan,
    firstAdminEmail: '',
    firstAdminName: '',
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        description="Clientes Venzo. Crie, suspenda e impersone a partir daqui."
        meta={list.data && `${list.data.length} tenant${list.data.length === 1 ? '' : 's'}`}
        primaryAction={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            + Novo tenant
          </Button>
        }
      />

      <Table>
        <THead>
          <tr>
            <TH sortable sortState={getSortState(SORT_T_NAME)} onSort={() => toggleSort(SORT_T_NAME)}>
              Nome
            </TH>
            <TH sortable sortState={getSortState(SORT_T_PLAN)} onSort={() => toggleSort(SORT_T_PLAN)}>
              Plano
            </TH>
            <TH sortable sortState={getSortState(SORT_T_STATUS)} onSort={() => toggleSort(SORT_T_STATUS)}>
              Status
            </TH>
            <TH sortable sortState={getSortState(SORT_T_USERS)} onSort={() => toggleSort(SORT_T_USERS)}>
              Users
            </TH>
            <TH sortable sortState={getSortState(SORT_T_OPPS)} onSort={() => toggleSort(SORT_T_OPPS)}>
              Opps
            </TH>
            <TH sortable sortState={getSortState(SORT_T_CREATED)} onSort={() => toggleSort(SORT_T_CREATED)}>
              Criado
            </TH>
          </tr>
        </THead>
        {list.isLoading ? (
          <TableSkeleton cols={6} rows={6} />
        ) : (
          <TBody>
            {list.data && sorted.length === 0 && (
              <TableEmpty colSpan={6}>
                Nenhum tenant ainda. Crie o primeiro para começar.
              </TableEmpty>
            )}
            {sorted.map((t) => (
              <TR
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/platform/tenants/${t.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/platform/tenants/${t.id}`);
                  }
                }}
                className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <TD>
                  <span className="font-medium text-brand-primary-light">{t.name}</span>
                  <span className="block text-caption text-text-3 font-mono">{t.slug}</span>
                </TD>
                <TD>
                  <Badge variant={PLAN_VARIANT[t.plan]}>{t.plan}</Badge>
                </TD>
                <TD>
                  <Badge variant={t.subscriptionStatus === 'PAST_DUE' ? 'danger' : 'default'}>
                    {t.subscriptionStatus ?? '—'}
                  </Badge>
                </TD>
                <TD className="text-text-2">{t._count.users}</TD>
                <TD className="text-text-2">{t._count.opportunities}</TD>
                <TD className="text-text-2 text-caption">
                  {new Date(t.createdAt).toLocaleDateString('pt-BR')}
                </TD>
              </TR>
            ))}
          </TBody>
        )}
      </Table>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Novo tenant"
        description="Cadastra o tenant e envia convite Clerk para o primeiro Admin."
        size="lg"
      >
        <form
          className="grid md:grid-cols-2 gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setCreateError(null);
            create.mutate({
              ...form,
              cnpj: form.cnpj.replace(/\D/g, ''),
            });
          }}
        >
          <Field label="Nome" required>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Slug" required>
            <Input
              required
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
            />
          </Field>
          <Field label="Razão social" required className="md:col-span-2">
            <Input
              required
              value={form.razaoSocial}
              onChange={(e) => setForm((f) => ({ ...f, razaoSocial: e.target.value }))}
            />
          </Field>
          <Field label="CNPJ" required>
            <Input
              required
              value={form.cnpj}
              onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
              placeholder="00.000.000/0000-00"
            />
          </Field>
          <Field label="Plano" required>
            <Select
              value={form.plan}
              onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value as TenantPlan }))}
            >
              <option value="TRIAL">Trial (14 dias)</option>
              <option value="STARTER">Starter</option>
              <option value="PRO">Pro</option>
              <option value="ENTERPRISE">Enterprise</option>
            </Select>
          </Field>
          <Field label="E-mail do primeiro admin" required className="md:col-span-2">
            <Input
              type="email"
              required
              value={form.firstAdminEmail}
              onChange={(e) => setForm((f) => ({ ...f, firstAdminEmail: e.target.value }))}
            />
          </Field>
          <Field label="Nome do primeiro admin" required className="md:col-span-2">
            <Input
              required
              value={form.firstAdminName}
              onChange={(e) => setForm((f) => ({ ...f, firstAdminName: e.target.value }))}
            />
          </Field>
          {createError && (
            <p role="alert" className="md:col-span-2 text-caption text-danger">
              {createError}
            </p>
          )}
          <ModalFooter className="md:col-span-2">
            <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" loading={create.isPending}>
              Criar tenant
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
