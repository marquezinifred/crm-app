'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApprovalRuleCriteria } from '@prisma/client';

const APPROVER_ROLES = [
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
] as const;

const CRITERIA_LABELS: Record<ApprovalRuleCriteria, string> = {
  UNIVERSAL: 'Universal — todas as propostas',
  MIN_MARGIN_BELOW: 'Margem abaixo de X%',
  TOTAL_VALUE_ABOVE: 'Valor acima de R$ X',
};

export default function ApprovalRulesPage() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { data } = trpc.approvalRules.list.useQuery();
  const [form, setForm] = useState<{
    name: string;
    criteria: ApprovalRuleCriteria;
    thresholdNumeric: string;
    approverRoles: typeof APPROVER_ROLES[number][];
  }>({
    name: '',
    criteria: 'MIN_MARGIN_BELOW',
    thresholdNumeric: '',
    approverRoles: ['DIRETOR_COMERCIAL'],
  });

  const create = trpc.approvalRules.create.useMutation({
    onSuccess: () => {
      setForm({ ...form, name: '', thresholdNumeric: '' });
      utils.approvalRules.list.invalidate();
      toast({ kind: 'success', title: 'Regra criada.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });
  const remove = trpc.approvalRules.remove.useMutation({
    onSuccess: () => {
      utils.approvalRules.list.invalidate();
      toast({ kind: 'success', title: 'Regra removida.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });
  const toggle = trpc.approvalRules.update.useMutation({
    onSuccess: () => {
      utils.approvalRules.list.invalidate();
      toast({ kind: 'success', title: 'Regra atualizada.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <PageHeader
        title="Regras de aprovação"
        description="Cada nova versão de proposta passa por estas regras. Aprovações pendentes bloqueiam o avanço para Aceite."
      />

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
          Nova regra
        </h2>
        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              name: form.name,
              criteria: form.criteria,
              thresholdNumeric: form.thresholdNumeric ? Number(form.thresholdNumeric) : undefined,
              approverRoles: form.approverRoles,
            });
          }}
        >
          <label className="block">
            <span className="mb-0.5 block text-xs">Nome</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs">Critério</span>
            <select
              value={form.criteria}
              onChange={(e) => setForm({ ...form, criteria: e.target.value as ApprovalRuleCriteria })}
              className="w-full rounded border px-2 py-1"
            >
              {Object.entries(CRITERIA_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          {form.criteria !== 'UNIVERSAL' && (
            <label className="block">
              <span className="mb-0.5 block text-xs">
                Threshold ({form.criteria === 'MIN_MARGIN_BELOW' ? '%' : 'R$'})
              </span>
              <input
                required
                type="number"
                min="0"
                step={form.criteria === 'MIN_MARGIN_BELOW' ? 0.1 : 1000}
                value={form.thresholdNumeric}
                onChange={(e) => setForm({ ...form, thresholdNumeric: e.target.value })}
                className="w-full rounded border px-2 py-1"
              />
            </label>
          )}
          <fieldset>
            <legend className="mb-1 text-xs">Aprovadores (perfis necessários)</legend>
            <div className="flex flex-wrap gap-2">
              {APPROVER_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.approverRoles.includes(r)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        approverRoles: e.target.checked
                          ? [...form.approverRoles, r]
                          : form.approverRoles.filter((x) => x !== r),
                      })
                    }
                  />
                  <span className="text-xs">{r}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Adicionar regra'}
          </Button>
        </form>
      </section>

      {data && data.length === 0 && (
        <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
          Nenhuma regra configurada — propostas avançam sem aprovação.
        </p>
      )}

      <ul className="space-y-2">
        {data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-border bg-card p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-text-2">
                {CRITERIA_LABELS[r.criteria]}
                {r.thresholdNumeric != null && ` · threshold ${Number(r.thresholdNumeric)}`}
              </p>
              <p className="text-xs text-text-2">
                aprovadores: {r.approverRoles.join(', ')}
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}
              >
                {r.enabled ? 'Desativar' : 'Ativar'}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm(`Remover regra "${r.name}"?`)) remove.mutate({ id: r.id });
                }}
              >
                Remover
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
