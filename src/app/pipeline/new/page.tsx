'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { OpportunitySource } from '@prisma/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { QuickCreateTrigger } from '@/components/ui/quick-create-trigger';
import { formatBRLInput, unformatBRLInput } from '@/lib/utils/format';

export default function NewOpportunityPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const me = trpc.users.me.useQuery();
  const companies = trpc.companies.list.useQuery({ type: 'CLIENT', page: 1, pageSize: 100 });
  const partners = trpc.companies.list.useQuery({ type: 'PARTNER', page: 1, pageSize: 100 });
  const users = trpc.users.list.useQuery({ active: true });
  const leadSources = trpc.leadSources.list.useQuery();

  const [form, setForm] = useState<{
    title: string;
    clientCompanyId: string;
    ownerId: string;
    source: OpportunitySource;
    sourceDetail: string;
    leadSourceId: string;
    estimatedValue: string;
    expectedCloseDate: string;
    description: string;
    partnerCompanyId: string;
  }>({
    title: '',
    clientCompanyId: '',
    ownerId: '',
    source: OpportunitySource.INDICACAO,
    sourceDetail: '',
    leadSourceId: '',
    estimatedValue: '',
    expectedCloseDate: '',
    description: '',
    partnerCompanyId: '',
  });

  const create = trpc.opportunities.create.useMutation({
    onSuccess: (opp) => {
      toast({
        kind: 'success',
        title: `Oportunidade ${opp.title} criada no pipeline.`,
      });
      router.push(`/pipeline/${opp.id}`);
    },
  });

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <PageHeader
        title="Nova oportunidade"
        description="Cadastre o essencial agora — você completa os campos por estágio depois."
      />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            title: form.title,
            clientCompanyId: form.clientCompanyId,
            ownerId: form.ownerId || me.data?.id || '',
            source: form.source,
            sourceDetail: form.sourceDetail || undefined,
            estimatedValue: form.estimatedValue ? unformatBRLInput(form.estimatedValue) : undefined,
            expectedCloseDate: form.expectedCloseDate
              ? new Date(form.expectedCloseDate)
              : undefined,
            description: form.description || undefined,
            partnerCompanyId: form.partnerCompanyId || undefined,
          });
        }}
      >
        <Field label="Título" required>
          <Input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex: Renovação anual ACME"
          />
        </Field>

        <Field label="Empresa cliente" required>
          <div className="flex items-center gap-2">
            <Select
              required
              value={form.clientCompanyId}
              onChange={(e) => setForm({ ...form, clientCompanyId: e.target.value })}
              className="flex-1"
            >
              <option value="">Selecione…</option>
              {companies.data?.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeFantasia ?? c.razaoSocial}
                </option>
              ))}
            </Select>
            <QuickCreateTrigger
              entity="company"
              triggerLabel="+ Nova empresa"
              onCreated={(id) => {
                setForm((cur) => ({ ...cur, clientCompanyId: id }));
                utils.companies.list.invalidate();
              }}
            />
          </div>
        </Field>

        <Field label="Responsável interno" required>
          <Select
            required
            value={form.ownerId}
            onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
          >
            <option value="">Selecione…</option>
            {users.data
              ?.filter((u) => u.role !== 'PARCEIRO')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.role})
                </option>
              ))}
          </Select>
        </Field>

        <Field label="Origem" required>
          <Select
            value={form.source}
            onChange={(e) =>
              setForm({ ...form, source: e.target.value as OpportunitySource })
            }
          >
            {Object.values(OpportunitySource).map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>

        {leadSources.data && leadSources.data.length > 0 && (
          <Field
            label="Origem detalhada"
            helper="Configurável em /admin/listas › Origens."
          >
            <Select
              value={form.leadSourceId}
              onChange={(e) => setForm({ ...form, leadSourceId: e.target.value })}
            >
              <option value="">—</option>
              {leadSources.data.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {form.source === 'PARCEIRO' && (
          <Field label="Parceiro indicado">
            <Select
              value={form.partnerCompanyId}
              onChange={(e) => setForm({ ...form, partnerCompanyId: e.target.value })}
            >
              <option value="">Selecione…</option>
              {partners.data?.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeFantasia ?? c.razaoSocial}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Valor estimado (R$)">
            <Input
              type="text"
              inputMode="decimal"
              value={form.estimatedValue}
              onChange={(e) =>
                setForm({ ...form, estimatedValue: formatBRLInput(e.target.value) })
              }
              placeholder="0"
            />
          </Field>
          <Field label="Data prevista de fechamento">
            <Input
              type="date"
              value={form.expectedCloseDate}
              onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Descrição">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
          />
        </Field>

        {create.error && (
          <p role="alert" className="text-caption text-danger">
            {friendlyTrpcError(create.error)}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={create.isLoading}>
            Criar oportunidade
          </Button>
        </div>
      </form>
    </main>
  );
}
