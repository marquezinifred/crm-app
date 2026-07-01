'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { AiFeatureCategory, AIProvider } from '@prisma/client';

type PlanInclusion = 'disabled' | 'included' | 'addon';
type PlanKey = 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';

const PLAN_ORDER: PlanKey[] = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];

const emptyForm = {
  code: '',
  name: '',
  description: '',
  category: 'SUMMARIZATION' as AiFeatureCategory,
  defaultProvider: 'ANTHROPIC' as AIProvider,
  defaultModel: 'claude-haiku-4-5-20251001',
  defaultInclusion: {
    TRIAL: 'included' as PlanInclusion,
    STARTER: 'disabled' as PlanInclusion,
    PRO: 'included' as PlanInclusion,
    ENTERPRISE: 'included' as PlanInclusion,
  },
  addonPriceBrlMonthly: '' as string,
  addonPriceBrlPerUse: '' as string,
};

export default function PlatformAiMarketplacePage() {
  const list = trpc.platform.aiMarketplace.list.useQuery();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const create = trpc.platform.aiMarketplace.createFeature.useMutation({
    onSuccess: () => {
      utils.platform.aiMarketplace.list.invalidate();
      setCreateOpen(false);
      setForm(emptyForm);
    },
    onError: (e) => setCreateError(friendlyTrpcError(e)),
  });

  function openCreate() {
    setCreateError(null);
    setForm(emptyForm);
    setCreateOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Marketplace"
        description="Catálogo de features de IA disponíveis para os tenants. Edição por tenant em /platform/tenants/[id]/ai/features."
        meta={list.data && `${list.data.length} feature${list.data.length === 1 ? '' : 's'}`}
        primaryAction={
          <Button variant="primary" onClick={openCreate}>
            + Nova feature
          </Button>
        }
      />

      <Table>
        <THead>
          <tr>
            <TH>Code</TH>
            <TH>Nome</TH>
            <TH>Categoria</TH>
            <TH>Provider/Model</TH>
            <TH>Add-on R$/mês</TH>
            <TH>Tenants ativos</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {list.data && list.data.length === 0 && (
            <TableEmpty colSpan={7}>
              Catálogo vazio — cadastre a primeira feature.
            </TableEmpty>
          )}
          {list.data?.map((f) => (
            <TR key={f.id}>
              <TD>
                <code className="text-mono text-caption text-brand-primary-light">{f.code}</code>
              </TD>
              <TD>
                <span className="font-medium">{f.name}</span>
                <p className="text-caption text-text-3 mt-0.5 max-w-xs">{f.description}</p>
              </TD>
              <TD><Badge variant="default">{f.category}</Badge></TD>
              <TD className="text-caption text-text-2 font-mono">
                {f.defaultProvider}
                <span className="block text-text-3">{f.defaultModel}</span>
              </TD>
              <TD className="font-mono tabular-nums text-text-1">
                {f.addonPriceBrlMonthly ? `R$ ${Number(f.addonPriceBrlMonthly).toFixed(2)}` : '—'}
              </TD>
              <TD className="text-text-2">{f._count.tenantStates}</TD>
              <TD>
                <Badge variant={f.active ? 'success' : 'default'}>
                  {f.active ? 'Ativa' : 'Desligada'}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nova feature"
        description="Adiciona uma feature ao catálogo global. Os tenants podem ligá-la via /platform/tenants/[id]/ai/features."
        size="lg"
      >
        <form
          className="grid md:grid-cols-2 gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setCreateError(null);
            create.mutate({
              code: form.code.trim(),
              name: form.name.trim(),
              description: form.description.trim(),
              category: form.category,
              defaultProvider: form.defaultProvider,
              defaultModel: form.defaultModel.trim(),
              defaultInclusion: form.defaultInclusion,
              addonPriceBrlMonthly:
                form.addonPriceBrlMonthly.trim() === ''
                  ? null
                  : Number(form.addonPriceBrlMonthly),
              addonPriceBrlPerUse:
                form.addonPriceBrlPerUse.trim() === ''
                  ? null
                  : Number(form.addonPriceBrlPerUse),
            });
          }}
        >
          <Field
            label="Code"
            required
            helper="kebab-case-only, ex: email-classify"
          >
            <Input
              required
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
              placeholder="email-classify"
              className="font-mono"
            />
          </Field>
          <Field label="Nome" required>
            <Input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Classificação de e-mails"
            />
          </Field>
          <Field label="Descrição" required className="md:col-span-2">
            <Textarea
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="O que a feature faz — visível para o Admin do tenant."
            />
          </Field>
          <Field label="Categoria" required>
            <Select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as AiFeatureCategory }))}
            >
              {Object.values(AiFeatureCategory).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Provider padrão" required>
            <Select
              value={form.defaultProvider}
              onChange={(e) => setForm((f) => ({ ...f, defaultProvider: e.target.value as AIProvider }))}
            >
              {Object.values(AIProvider).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="Modelo padrão" required className="md:col-span-2" helper="Ex: claude-haiku-4-5-20251001, gpt-4o-mini, gemini-1.5-flash, text-embedding-3-small">
            <Input
              required
              value={form.defaultModel}
              onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
              className="font-mono"
            />
          </Field>

          <fieldset className="md:col-span-2 border border-border rounded-md p-3 space-y-2">
            <legend className="text-caption text-text-2 px-1">Inclusão por plano</legend>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PLAN_ORDER.map((plan) => (
                <Field key={plan} label={plan}>
                  <Select
                    value={form.defaultInclusion[plan]}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        defaultInclusion: {
                          ...f.defaultInclusion,
                          [plan]: e.target.value as PlanInclusion,
                        },
                      }))
                    }
                  >
                    <option value="disabled">disabled</option>
                    <option value="included">included</option>
                    <option value="addon">addon</option>
                  </Select>
                </Field>
              ))}
            </div>
          </fieldset>

          <Field label="Add-on R$/mês (opcional)">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.addonPriceBrlMonthly}
              onChange={(e) => setForm((f) => ({ ...f, addonPriceBrlMonthly: e.target.value }))}
              placeholder="89.00"
            />
          </Field>
          <Field label="Add-on R$/uso (opcional)" helper="Por chamada ou por 1000 tokens — decisão contextual da feature.">
            <Input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min="0"
              value={form.addonPriceBrlPerUse}
              onChange={(e) => setForm((f) => ({ ...f, addonPriceBrlPerUse: e.target.value }))}
              placeholder="0.0500"
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
              Criar feature
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
