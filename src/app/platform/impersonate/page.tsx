'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Impersonação — Sprint 15A.
 *
 * Fluxo dirigido: Platform Owner escolhe (1) tenant alvo e (2) admin
 * daquele tenant. O backend devolve `sessionId` + dados do alvo —
 * neste sprint A apenas registramos a intenção em audit log. A geração
 * real de cookie Clerk fica para um sub-sprint dedicado depois que o
 * fluxo for validado em staging.
 */
export default function PlatformImpersonatePage() {
  const [tenantId, setTenantId] = useState('');
  const [userId, setUserId] = useState('');
  const [session, setSession] = useState<{ sessionId: string; targetEmail: string; targetRole: string } | null>(null);

  const tenants = trpc.platform.tenantsList.useQuery({});
  const detail = trpc.platform.tenantById.useQuery({ id: tenantId }, { enabled: Boolean(tenantId) });
  const start = trpc.platform.impersonateStart.useMutation({
    onSuccess: (data) => {
      setSession({
        sessionId: data.sessionId,
        targetEmail: data.target.email,
        targetRole: data.target.role,
      });
    },
  });
  const end = trpc.platform.impersonateEnd.useMutation({
    onSuccess: () => setSession(null),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Impersonar"
        description="Acesse um tenant como admin para diagnóstico. Toda ação fica registrada com seu ID no audit log."
      />

      {session ? (
        <div className="rounded-md border border-danger/40 bg-danger-bg/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="danger">Sessão preparada</Badge>
            <code className="text-mono text-brand-primary-light text-caption">{session.sessionId}</code>
          </div>
          <p className="text-body text-danger-text">
            Sessão de impersonação registrada para{' '}
            <strong>{session.targetEmail}</strong> ({session.targetRole}).
            O cookie Clerk real é gerado no momento do uso em staging.
          </p>
          <Button
            variant="ghost"
            onClick={() =>
              end.mutate({
                sessionId: session.sessionId,
                tenantId,
                asUserId: userId,
              })
            }
            loading={end.isPending}
          >
            Encerrar sessão
          </Button>
        </div>
      ) : (
        <form
          className="rounded-md border border-border bg-card p-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate({ tenantId, asUserId: userId });
          }}
        >
          <Field label="Tenant alvo" required>
            <Select
              required
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setUserId('');
              }}
            >
              <option value="">— escolher —</option>
              {tenants.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.slug})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Atuar como" required>
            <Select
              required
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={!tenantId || detail.isLoading}
            >
              <option value="">— escolher usuário —</option>
              {detail.data?.members
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName} · {m.email} ({m.role})
                  </option>
                ))}
            </Select>
          </Field>

          {start.error && (
            <p role="alert" className="text-caption text-danger">{start.error.message}</p>
          )}

          <Button type="submit" variant="primary" disabled={!tenantId || !userId} loading={start.isPending}>
            Preparar sessão
          </Button>
        </form>
      )}

      <div className="text-caption text-text-3 max-w-prose">
        Toda mutação durante uma impersonação grava{' '}
        <code>metadata.impersonated_by</code> no audit log. Use o filtro em{' '}
        <code>/platform/audit</code> para auditar ações suas em nome de tenants.
      </div>
    </div>
  );
}
