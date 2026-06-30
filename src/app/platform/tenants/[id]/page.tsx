'use client';

import Link from 'next/link';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export default function PlatformTenantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const utils = trpc.useUtils();
  const detail = trpc.platform.tenantById.useQuery({ id: params.id });
  const suspend = trpc.platform.tenantSuspend.useMutation({
    onSuccess: () => {
      utils.platform.tenantById.invalidate({ id: params.id });
      utils.platform.tenantsList.invalidate();
      setSuspendOpen(false);
    },
  });
  const unsuspend = trpc.platform.tenantUnsuspend.useMutation({
    onSuccess: () => {
      utils.platform.tenantById.invalidate({ id: params.id });
      utils.platform.tenantsList.invalidate();
    },
  });
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  if (detail.isLoading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-4 w-1/3" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <p role="alert" className="text-body text-danger">
        {detail.error?.message ?? 'Tenant não encontrado.'}
      </p>
    );
  }

  const { tenant, members, recentBillingEvents, aiUsage30d } = detail.data;
  const isSuspended = Boolean(tenant.deletedAt);

  return (
    <div className="space-y-6 max-w-4xl">
      <nav aria-label="Trilha" className="text-caption text-text-2">
        <Link href="/platform/tenants" className="underline hover:text-text-1">
          ← Voltar para tenants
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1">{tenant.name}</h1>
          <p className="text-caption text-text-2 font-mono mt-1">{tenant.slug}</p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant="primary">{tenant.plan}</Badge>
            {tenant.subscriptionStatus && (
              <Badge variant={tenant.subscriptionStatus === 'PAST_DUE' ? 'danger' : 'default'}>
                {tenant.subscriptionStatus}
              </Badge>
            )}
            {isSuspended && <Badge variant="danger">Suspenso</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/platform/impersonate?tenant=${tenant.id}`}>
            <Button variant="secondary">Impersonar admin</Button>
          </Link>
          {isSuspended ? (
            <Button variant="primary" loading={unsuspend.isPending} onClick={() => unsuspend.mutate({ id: tenant.id })}>
              Reativar
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setSuspendOpen(true)}>
              Suspender
            </Button>
          )}
        </div>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="members">
            Membros <Badge variant="default">{members.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="config">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <dl className="grid grid-cols-2 gap-4 text-body">
            <Item label="Usuários" value={tenant._count.users.toString()} />
            <Item label="Empresas" value={tenant._count.companies.toString()} />
            <Item label="Contatos" value={tenant._count.contacts.toString()} />
            <Item label="Oportunidades" value={tenant._count.opportunities.toString()} />
            <Item label="Contratos" value={tenant._count.contracts.toString()} />
            <Item label="Tokens IA (30d)" value={aiUsage30d.tokens.toLocaleString('pt-BR')} />
            <Item label="Custo IA (30d)" value={`US$ ${aiUsage30d.costUsd.toFixed(2)}`} />
            {tenant.trialEndsAt && (
              <Item label="Trial termina em" value={new Date(tenant.trialEndsAt).toLocaleDateString('pt-BR')} />
            )}
            {tenant.currentPeriodEnd && (
              <Item label="Renova em" value={new Date(tenant.currentPeriodEnd).toLocaleDateString('pt-BR')} />
            )}
          </dl>
        </TabsContent>

        <TabsContent value="members">
          <ul className="divide-y divide-border">
            {members.map((u) => (
              <li key={u.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-body font-medium text-text-1">{u.fullName}</p>
                  <p className="text-caption text-text-2">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={u.active ? 'default' : 'warning'}>{u.role}</Badge>
                  {u.lastLoginAt && (
                    <span className="text-caption text-text-3">
                      último login {new Date(u.lastLoginAt).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="billing">
          {recentBillingEvents.length === 0 ? (
            <p className="text-body text-text-2">Sem eventos Stripe registrados.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentBillingEvents.map((ev) => (
                <li key={ev.id} className="py-2 flex justify-between text-body">
                  <span>
                    <Badge variant="default">{ev.type}</Badge>
                    {ev.error && <span className="ml-2 text-caption text-danger">{ev.error}</span>}
                  </span>
                  <span className="text-caption text-text-3">
                    {new Date(ev.processedAt).toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="config">
          <p className="text-body text-text-2">
            Feature flags por tenant ficam em <code>/platform/feature-flags</code>.
          </p>
        </TabsContent>
      </Tabs>

      <Modal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Suspender tenant?"
        description="Usuários perdem acesso e veem mensagem de conta suspensa. O histórico é preservado."
        size="sm"
      >
        <Field label="Motivo" required>
          <Input
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Ex: inadimplência confirmada por 3 ciclos."
          />
        </Field>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setSuspendOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            loading={suspend.isPending}
            disabled={suspendReason.length < 3}
            onClick={() => suspend.mutate({ id: tenant.id, reason: suspendReason })}
          >
            Suspender
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-text-3">{label}</dt>
      <dd className="text-text-1 mt-1">{value}</dd>
    </div>
  );
}
