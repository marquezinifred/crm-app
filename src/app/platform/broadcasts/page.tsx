'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { BroadcastTarget, BroadcastVariant } from '@prisma/client';

export default function PlatformBroadcastsPage() {
  const utils = trpc.useUtils();
  const list = trpc.platform.broadcasts.list.useQuery();
  const create = trpc.platform.broadcasts.create.useMutation({
    onSuccess: () => {
      utils.platform.broadcasts.list.invalidate();
      setOpen(false);
      setError(null);
    },
    onError: (e) => setError(friendlyTrpcError(e)),
  });
  const remove = trpc.platform.broadcasts.delete.useMutation({
    onSuccess: () => utils.platform.broadcasts.list.invalidate(),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    message: '',
    variant: 'INFO' as BroadcastVariant,
    target: 'ALL' as BroadcastTarget,
    targetPlans: '',
    actionLabel: '',
    actionUrl: '',
    startsAt: new Date().toISOString().slice(0, 16),
    endsAt: '',
    dismissible: true,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Broadcasts"
        description="Banners contextuais entregues para tenants. Substitui o NEXT_PUBLIC_MAINTENANCE_MESSAGE."
        primaryAction={
          <Button variant="primary" onClick={() => setOpen(true)}>+ Novo broadcast</Button>
        }
      />

      <Table>
        <THead>
          <tr>
            <TH>Título</TH>
            <TH>Variant</TH>
            <TH>Target</TH>
            <TH>Janela</TH>
            <TH>Status</TH>
            <TH>Ações</TH>
          </tr>
        </THead>
        <TBody>
          {list.data && list.data.length === 0 && (
            <TableEmpty colSpan={6}>Sem broadcasts ainda.</TableEmpty>
          )}
          {list.data?.map((b) => {
            const now = new Date();
            const status = !b.active
              ? 'INATIVO'
              : b.startsAt > now
                ? 'AGENDADO'
                : b.endsAt && b.endsAt < now
                  ? 'EXPIRADO'
                  : 'ATIVO';
            return (
              <TR key={b.id}>
                <TD>
                  <span className="font-medium">{b.title}</span>
                  <p className="text-caption text-text-3 mt-0.5 max-w-xs truncate">{b.message}</p>
                </TD>
                <TD><Badge variant={b.variant === 'DANGER' ? 'danger' : b.variant === 'WARNING' ? 'warning' : b.variant === 'SUCCESS' ? 'success' : 'info'}>{b.variant}</Badge></TD>
                <TD className="text-caption text-text-2">
                  {b.target === 'ALL' && 'Todos'}
                  {b.target === 'BY_PLAN' && `Plano: ${b.targetPlans.join(', ')}`}
                  {b.target === 'MANUAL_LIST' && `${b.targetTenantIds.length} tenants`}
                </TD>
                <TD className="text-caption text-text-2">
                  {new Date(b.startsAt).toLocaleDateString('pt-BR')}
                  {b.endsAt && ` → ${new Date(b.endsAt).toLocaleDateString('pt-BR')}`}
                </TD>
                <TD><Badge variant={status === 'ATIVO' ? 'success' : 'default'}>{status}</Badge></TD>
                <TD>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate({ id: b.id })}
                    loading={remove.isPending}
                  >
                    Desligar
                  </Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo broadcast"
        size="lg"
      >
        <form
          className="grid md:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate({
              title: form.title,
              message: form.message,
              variant: form.variant,
              target: form.target,
              targetPlans:
                form.target === 'BY_PLAN'
                  ? form.targetPlans.split(',').map((s) => s.trim()).filter(Boolean)
                  : [],
              targetTenantIds: [],
              startsAt: new Date(form.startsAt),
              endsAt: form.endsAt ? new Date(form.endsAt) : null,
              actionLabel: form.actionLabel || null,
              actionUrl: form.actionUrl || null,
              dismissible: form.dismissible,
            });
          }}
        >
          <Field label="Título" required className="md:col-span-2">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Mensagem" required className="md:col-span-2">
            <Textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} />
          </Field>
          <Field label="Variant">
            <Select value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value as BroadcastVariant })}>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="DANGER">Danger</option>
              <option value="SUCCESS">Success</option>
            </Select>
          </Field>
          <Field label="Target">
            <Select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value as BroadcastTarget })}>
              <option value="ALL">Todos</option>
              <option value="BY_PLAN">Por plano</option>
              <option value="MANUAL_LIST">Lista manual</option>
            </Select>
          </Field>
          {form.target === 'BY_PLAN' && (
            <Field label="Planos (CSV)" className="md:col-span-2" helper="Ex: STARTER, PRO">
              <Input value={form.targetPlans} onChange={(e) => setForm({ ...form, targetPlans: e.target.value })} placeholder="STARTER, PRO" />
            </Field>
          )}
          <Field label="Começa em" required>
            <Input type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </Field>
          <Field label="Termina em (opcional)">
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </Field>
          <Field label="Action label (opcional)">
            <Input value={form.actionLabel} onChange={(e) => setForm({ ...form, actionLabel: e.target.value })} placeholder="Resolver" />
          </Field>
          <Field label="Action URL (opcional)">
            <Input type="url" value={form.actionUrl} onChange={(e) => setForm({ ...form, actionUrl: e.target.value })} placeholder="https://..." />
          </Field>
          <label className="md:col-span-2 flex items-center gap-2 text-body">
            <input
              type="checkbox"
              checked={form.dismissible}
              onChange={(e) => setForm({ ...form, dismissible: e.target.checked })}
            />
            Permitir que o usuário dispense
          </label>
          {error && <p role="alert" className="md:col-span-2 text-caption text-danger">{error}</p>}
          <ModalFooter className="md:col-span-2">
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" loading={create.isPending}>Criar</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
