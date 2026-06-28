'use client';

import { trpc } from '@/lib/trpc/client';
import { AlertType, AlertStatus } from '@prisma/client';
import { urgencyFromDate } from '@/lib/utils/hooks';
import { cn } from '@/lib/utils/cn';
import { EnablePushButton } from '@/components/layout/EnablePushButton';

const urgencyColor = {
  ok: 'bg-emerald-500',
  soon: 'bg-amber-500',
  urgent: 'bg-red-500',
} as const;

export default function DashboardPage() {
  const me = trpc.users.me.useQuery();
  const { data, isLoading, error } = trpc.alerts.myAlerts.useQuery({
    windowDays: 14,
    status: AlertStatus.PENDING,
  });

  const relationship = data?.filter((a) => a.type === AlertType.RELATIONSHIP_DATE) ?? [];
  const pipeline = data?.filter((a) => a.type === AlertType.PIPELINE_DATE) ?? [];

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Olá, {me.data?.fullName?.split(' ')[0] ?? ''}</h1>
          <p className="text-sm text-neutral-600">
            Central de Alertas — próximos 14 dias
          </p>
        </div>
        <EnablePushButton />
      </header>

      {isLoading && <p className="text-sm text-neutral-600">Carregando alertas…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <section className="mb-6">
        <h2 className="mb-3 flex items-center justify-between text-base font-semibold">
          <span>Relacionamento</span>
          <span className="text-xs text-neutral-500">{relationship.length}</span>
        </h2>
        {relationship.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            Sem datas próximas de empresas ou contatos.
          </p>
        ) : (
          <ul className="space-y-2">
            {relationship.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 flex items-center justify-between text-base font-semibold">
          <span>Pipeline</span>
          <span className="text-xs text-neutral-500">{pipeline.length}</span>
        </h2>
        {pipeline.length === 0 ? (
          <p className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            Sem marcos próximos no pipeline.
          </p>
        ) : (
          <ul className="space-y-2">
            {pipeline.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function AlertRow({
  alert,
}: {
  alert: {
    id: string;
    type: AlertType;
    entityType: string;
    entityId: string;
    scheduledFor: Date;
    payload: unknown;
  };
}) {
  const urgency = urgencyFromDate(alert.scheduledFor);
  const utils = trpc.useUtils();
  const dismiss = trpc.alerts.dismiss.useMutation({
    onSuccess: () => utils.alerts.myAlerts.invalidate(),
  });
  const p = (alert.payload ?? {}) as Record<string, unknown>;

  const label =
    alert.type === AlertType.RELATIONSHIP_DATE
      ? String(p.label ?? p.dateType ?? 'Data importante')
      : `${p.marker ?? 'Marco'} — ${p.opportunityTitle ?? ''}`;

  const link =
    alert.type === AlertType.RELATIONSHIP_DATE
      ? `/${alert.entityType.toLowerCase()}s/${alert.entityId}`
      : `/pipeline/${alert.entityId}`;

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', urgencyColor[urgency])} aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="text-xs text-neutral-600">
            {new Date(alert.scheduledFor).toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <a
          href={link}
          className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50"
        >
          Abrir
        </a>
        <button
          type="button"
          onClick={() => dismiss.mutate({ id: alert.id })}
          className="rounded px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          Dispensar
        </button>
      </div>
    </li>
  );
}
