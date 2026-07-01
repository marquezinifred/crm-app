'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { UserRole } from '@prisma/client';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';
import {
  PERMISSIONS_CATALOG,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  type Permission,
  type PermissionCategory,
} from '@/lib/auth/permissions-catalog';

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'Admin',
  DIRETOR_COMERCIAL: 'Diretor Comercial',
  DIRETOR_OPERACOES: 'Diretor de Operações',
  DIRETOR_FINANCEIRO: 'Diretor Financeiro',
  GESTOR: 'Gestor',
  ANALISTA: 'Analista',
  PARCEIRO: 'Parceiro',
};

/**
 * Sprint 15E — página de gestão de permissions individuais.
 *
 * Estados por permission:
 *   ✅ default (do role) + granted (override redundante) → só mostra "default"
 *   ✅ default (do role) sem override → "default"
 *   ✅ granted (não é default) → "concedida"
 *   ❌ revoked (era default) → "revogada"
 *   ☐ sem default e sem override → "não concedida"
 *
 * Ações por estado:
 *   default → botão "Revogar"
 *   granted → botão "Restaurar padrão" (remove override)
 *   revoked → botão "Restaurar padrão" (remove override → volta ao default)
 *   não concedida → botão "Conceder"
 */
export default function UserPermissionsPage() {
  const params = useParams();
  const userId = String(params.id);
  const { toast } = useToast();

  const utils = trpc.useUtils();
  const forUser = trpc.permissions.forUser.useQuery({ userId });
  const grant = trpc.permissions.grant.useMutation({
    onSuccess: () => {
      utils.permissions.forUser.invalidate({ userId });
      toast({ kind: 'success', title: 'Permissão concedida' });
    },
    onError: (e) =>
      toast({ kind: 'error', title: 'Erro', description: friendlyTrpcError(e) }),
  });
  const revoke = trpc.permissions.revoke.useMutation({
    onSuccess: () => {
      utils.permissions.forUser.invalidate({ userId });
      toast({ kind: 'success', title: 'Permissão revogada' });
    },
    onError: (e) =>
      toast({ kind: 'error', title: 'Erro', description: friendlyTrpcError(e) }),
  });
  const restore = trpc.permissions.restore.useMutation({
    onSuccess: () => {
      utils.permissions.forUser.invalidate({ userId });
      toast({ kind: 'success', title: 'Padrão restaurado' });
    },
    onError: (e) =>
      toast({ kind: 'error', title: 'Erro', description: friendlyTrpcError(e) }),
  });

  const [pendingReason, setPendingReason] = useState('');
  const [confirmingRevoke, setConfirmingRevoke] = useState<Permission | null>(null);

  const data = forUser.data;
  const defaultsSet = useMemo(
    () => new Set<Permission>((data?.defaults ?? []) as Permission[]),
    [data?.defaults],
  );
  const grantedSet = useMemo(
    () =>
      new Set(
        data?.overrides
          .filter((o) => o.action === 'granted')
          .map((o) => o.permission as Permission) ?? [],
      ),
    [data?.overrides],
  );
  const revokedSet = useMemo(
    () =>
      new Set(
        data?.overrides
          .filter((o) => o.action === 'revoked')
          .map((o) => o.permission as Permission) ?? [],
      ),
    [data?.overrides],
  );
  const overridesByPermission = useMemo(() => {
    const map = new Map<Permission, NonNullable<typeof data>['overrides'][number]>();
    for (const o of data?.overrides ?? []) {
      map.set(o.permission as Permission, o);
    }
    return map;
  }, [data?.overrides]);

  const permsByCategory = useMemo(() => {
    const map = new Map<PermissionCategory, typeof PERMISSIONS_CATALOG[number][]>();
    for (const p of PERMISSIONS_CATALOG) {
      const cat = p.category as PermissionCategory;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return map;
  }, []);

  if (forUser.isLoading) {
    return <div className="max-w-4xl mx-auto p-6 text-text-2">Carregando...</div>;
  }
  if (forUser.error || !data) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-3">
        <p className="text-danger">Não foi possível carregar as permissões deste usuário.</p>
        <Link href="/admin/users" className="text-brand-primary underline">
          ← Voltar aos usuários
        </Link>
      </div>
    );
  }

  function permissionState(p: Permission): 'default' | 'granted' | 'revoked' | 'none' {
    if (revokedSet.has(p)) return 'revoked';
    if (grantedSet.has(p) && !defaultsSet.has(p)) return 'granted';
    if (defaultsSet.has(p) && !revokedSet.has(p)) return 'default';
    return 'none';
  }

  function handleGrant(p: Permission) {
    grant.mutate({ userId, permission: p, reason: pendingReason || undefined });
    setPendingReason('');
  }
  function handleRevoke(p: Permission) {
    revoke.mutate({ userId, permission: p, reason: pendingReason || undefined });
    setPendingReason('');
    setConfirmingRevoke(null);
  }
  function handleRestore(p: Permission) {
    restore.mutate({ userId, permission: p });
    setPendingReason('');
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title={data.fullName}
        description={`${ROLE_LABEL[data.role as UserRole]} · ${data.email}`}
        secondaryAction={
          <Link
            href="/admin/users"
            className="text-sm text-text-2 hover:text-text-1"
          >
            ← Voltar aos usuários
          </Link>
        }
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-text-2">
          Total efetivo: <strong className="text-text-1">{data.counts.effective}</strong> permissões
          {' '}({data.counts.defaults} do perfil{' '}
          {data.counts.granted > 0 && <>+ {data.counts.granted} concedidas </>}
          {data.counts.revoked > 0 && <>− {data.counts.revoked} revogadas </>})
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-1 mb-1" htmlFor="reason-input">
          Motivo (opcional)
        </label>
        <input
          id="reason-input"
          type="text"
          value={pendingReason}
          maxLength={500}
          onChange={(e) => setPendingReason(e.target.value)}
          placeholder="Ex: nova responsabilidade, migração 15E..."
          className="w-full border border-border rounded-md px-3 py-2 text-sm bg-card"
        />
        <p className="text-xs text-text-3 mt-1">
          Aplicado à próxima concessão ou revogação. Persistido no audit log.
        </p>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const perms = permsByCategory.get(cat);
        if (!perms || perms.length === 0) return null;
        return (
          <details
            key={cat}
            open
            className="rounded-lg border border-border bg-card"
          >
            <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-text-1 flex items-center justify-between">
              <span>📁 {CATEGORY_LABELS[cat]}</span>
              <span className="text-xs text-text-3">{perms.length}</span>
            </summary>
            <ul className="divide-y divide-border">
              {perms.map((p) => {
                const state = permissionState(p.key);
                const override = overridesByPermission.get(p.key);
                return (
                  <li key={p.key} className="px-4 py-3 flex items-start gap-3">
                    <span className="text-lg mt-0.5" aria-hidden="true">
                      {state === 'default' && '✅'}
                      {state === 'granted' && '✅'}
                      {state === 'revoked' && '❌'}
                      {state === 'none' && '☐'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-1">
                          {p.label}
                        </span>
                        {state === 'granted' && (
                          <Badge variant="primary">Concedida</Badge>
                        )}
                        {state === 'revoked' && (
                          <Badge variant="danger">Revogada</Badge>
                        )}
                        {state === 'default' && !override && (
                          <Badge variant="default">Padrão</Badge>
                        )}
                      </div>
                      <div className="text-xs text-text-3 font-mono mt-0.5">
                        {p.key}
                      </div>
                      {override && override.grantedBy && (
                        <div className="text-xs text-text-2 mt-1">
                          {state === 'granted' ? 'concedida' : 'revogada'} em{' '}
                          {new Date(override.grantedAt).toLocaleDateString('pt-BR')}
                          {' '}por {override.grantedBy.fullName}
                          {override.reason && (
                            <> — &ldquo;{override.reason}&rdquo;</>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {state === 'none' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleGrant(p.key)}
                          disabled={grant.isPending}
                        >
                          Conceder
                        </Button>
                      )}
                      {state === 'default' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmingRevoke(p.key)}
                          disabled={revoke.isPending}
                        >
                          Revogar
                        </Button>
                      )}
                      {(state === 'granted' || state === 'revoked') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRestore(p.key)}
                          disabled={restore.isPending}
                        >
                          Restaurar padrão
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}

      <AlertDialog
        open={confirmingRevoke !== null}
        onCancel={() => setConfirmingRevoke(null)}
        title="Revogar permissão do perfil?"
        description={
          confirmingRevoke
            ? `Este usuário perderá acesso a "${
                PERMISSIONS_CATALOG.find((p) => p.key === confirmingRevoke)?.label ?? confirmingRevoke
              }". Ele poderá ser restaurado a qualquer momento.`
            : ''
        }
        confirmLabel="Revogar"
        cancelLabel="Cancelar"
        tone="danger"
        onConfirm={() => {
          if (confirmingRevoke) handleRevoke(confirmingRevoke);
        }}
      />
    </div>
  );
}
