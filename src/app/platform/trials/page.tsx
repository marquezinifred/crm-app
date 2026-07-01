'use client';

import { useMemo, useState } from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Select } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { formatRelativeDate } from '@/lib/utils/format';
import { useTableSort, type SortKey } from '@/lib/hooks/useTableSort';
import type { TenantPlan } from '@prisma/client';

type TrialRow = RouterOutputs['platform']['trials']['list'][number];

const SORT_TR_NAME: SortKey<TrialRow> = 'name';
const SORT_TR_SOURCE: SortKey<TrialRow> = 'trialSource';
const SORT_TR_ENDS: SortKey<TrialRow> = (t) =>
  t.trialEndsAt ? new Date(t.trialEndsAt) : null;
const SORT_TR_SETUP: SortKey<TrialRow> = (t) => Boolean(t.setupCompletedAt);
const SORT_TR_EXTENDED: SortKey<TrialRow> = 'trialExtendedCount';

export default function PlatformTrialsPage() {
  const utils = trpc.useUtils();
  const list = trpc.platform.trials.list.useQuery();
  const extend = trpc.platform.trials.extend.useMutation({
    onSuccess: () => {
      utils.platform.trials.list.invalidate();
      setActioning(null);
    },
  });
  const convert = trpc.platform.trials.convertManual.useMutation({
    onSuccess: () => {
      utils.platform.trials.list.invalidate();
      setActioning(null);
    },
  });

  const [actioning, setActioning] = useState<{
    kind: 'extend' | 'convert';
    tenantId: string;
    days?: number;
    plan?: TenantPlan;
  } | null>(null);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { sorted, toggleSort, getSortState } = useTableSort<TrialRow>(rows);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trials"
        description="Funil de trials ativos. Estenda, converta manualmente ou agende contato."
        meta={list.data && `${list.data.length} trial${list.data.length === 1 ? '' : 's'} aberto`}
      />

      <Table>
        <THead>
          <tr>
            <TH sortable sortState={getSortState(SORT_TR_NAME)} onSort={() => toggleSort(SORT_TR_NAME)}>
              Tenant
            </TH>
            <TH sortable sortState={getSortState(SORT_TR_SOURCE)} onSort={() => toggleSort(SORT_TR_SOURCE)}>
              Source
            </TH>
            <TH sortable sortState={getSortState(SORT_TR_ENDS)} onSort={() => toggleSort(SORT_TR_ENDS)}>
              Termina em
            </TH>
            <TH sortable sortState={getSortState(SORT_TR_SETUP)} onSort={() => toggleSort(SORT_TR_SETUP)}>
              Setup
            </TH>
            <TH sortable sortState={getSortState(SORT_TR_EXTENDED)} onSort={() => toggleSort(SORT_TR_EXTENDED)}>
              Estendido
            </TH>
            <TH>Ações</TH>
          </tr>
        </THead>
        <TBody>
          {list.data && sorted.length === 0 && (
            <TableEmpty colSpan={6}>Sem trials abertos no momento.</TableEmpty>
          )}
          {sorted.map((t) => {
            const daysLeft = t.trialEndsAt
              ? Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86_400_000)
              : null;
            return (
              <TR key={t.id}>
                <TD>
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-caption text-text-3 font-mono">{t.slug}</span>
                </TD>
                <TD className="text-text-2 text-caption">{t.trialSource ?? '—'}</TD>
                <TD>
                  {t.trialEndsAt ? (
                    <>
                      <span className="text-text-1">
                        {new Date(t.trialEndsAt).toLocaleDateString('pt-BR')}
                      </span>
                      <span className="block text-caption text-text-3">
                        {formatRelativeDate(new Date(t.trialEndsAt))}
                        {daysLeft != null && daysLeft < 3 && (
                          <Badge variant="danger" className="ml-2">⚠</Badge>
                        )}
                      </span>
                    </>
                  ) : '—'}
                </TD>
                <TD>
                  {t.setupCompletedAt ? (
                    <Badge variant="success">Concluído</Badge>
                  ) : (
                    <Badge variant="default">Em andamento</Badge>
                  )}
                </TD>
                <TD className="text-text-2">{t.trialExtendedCount}×</TD>
                <TD>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActioning({ kind: 'extend', tenantId: t.id, days: 7 })}
                  >
                    Estender
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setActioning({ kind: 'convert', tenantId: t.id, plan: 'STARTER' })}
                  >
                    Converter
                  </Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      {actioning?.kind === 'extend' && (
        <Modal
          open
          onClose={() => setActioning(null)}
          title="Estender trial"
          description="Aumenta a duração do trial sem ressetar progresso."
          size="sm"
        >
          <Field label="Dias">
            <Select
              value={String(actioning.days ?? 7)}
              onChange={(e) =>
                setActioning((cur) => cur && { ...cur, days: Number(e.target.value) })
              }
            >
              <option value="7">+7 dias</option>
              <option value="14">+14 dias</option>
              <option value="30">+30 dias</option>
            </Select>
          </Field>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setActioning(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={extend.isPending}
              onClick={() =>
                extend.mutate({ tenantId: actioning.tenantId, days: actioning.days ?? 7 })
              }
            >
              Estender
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {actioning?.kind === 'convert' && (
        <Modal
          open
          onClose={() => setActioning(null)}
          title="Converter manual"
          description="Cliente fechou offline — converte o trial em assinatura ativa."
          size="sm"
        >
          <Field label="Plano">
            <Select
              value={actioning.plan ?? 'STARTER'}
              onChange={(e) =>
                setActioning((cur) => cur && { ...cur, plan: e.target.value as TenantPlan })
              }
            >
              <option value="STARTER">Starter</option>
              <option value="PRO">Pro</option>
              <option value="ENTERPRISE">Enterprise</option>
            </Select>
          </Field>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setActioning(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={convert.isPending}
              onClick={() =>
                convert.mutate({
                  tenantId: actioning.tenantId,
                  plan: actioning.plan ?? 'STARTER',
                })
              }
            >
              Converter
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
