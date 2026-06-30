'use client';

import { trpc } from '@/lib/trpc/client';
import { AlertType, AlertStatus } from '@prisma/client';
import { urgencyFromDate } from '@/lib/utils/hooks';
import { cn } from '@/lib/utils/cn';
import { EnablePushButton } from '@/components/layout/EnablePushButton';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { Badge } from '@/components/ui/badge';

const urgencyColor = {
  ok: 'bg-success',
  soon: 'bg-warning',
  urgent: 'bg-danger',
} as const;

export default function DashboardPage() {
  const me = trpc.users.me.useQuery();
  const { data, isLoading, error } = trpc.alerts.myAlerts.useQuery({
    windowDays: 14,
    status: AlertStatus.PENDING,
  });

  const relationship = data?.filter((a) => a.type === AlertType.RELATIONSHIP_DATE) ?? [];
  const pipeline = data?.filter((a) => a.type === AlertType.PIPELINE_DATE) ?? [];
  const firstName = me.data?.fullName?.split(' ')[0] ?? '';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-text-1">
            Bom dia{firstName && `, ${firstName}`}.
          </h1>
          <p className="text-body text-text-2 mt-1">
            {relationship.length + pipeline.length > 0
              ? `${relationship.length + pipeline.length} compromissos aguardam você nos próximos 14 dias.`
              : 'Tudo em dia nos próximos 14 dias.'}
          </p>
        </div>
        <EnablePushButton />
      </header>

      <OnboardingChecklist />

      {error && (
        <div role="alert" className="rounded border border-danger/30 bg-danger-bg/40 text-danger-text p-3 text-body">
          Algo saiu errado. {error.message}
        </div>
      )}

      <section aria-labelledby="alerts-relationship">
        <header className="flex items-center justify-between mb-3">
          <h2 id="alerts-relationship" className="text-h3 text-text-1">Relacionamento</h2>
          <Badge variant="default">{relationship.length}</Badge>
        </header>
        {isLoading ? (
          <SkeletonList />
        ) : relationship.length === 0 ? (
          <EmptyCard>Ninguém com data importante nos próximos 14 dias.</EmptyCard>
        ) : (
          <ul className="space-y-2">
            {relationship.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="alerts-pipeline">
        <header className="flex items-center justify-between mb-3">
          <h2 id="alerts-pipeline" className="text-h3 text-text-1">Pipeline</h2>
          <Badge variant="default">{pipeline.length}</Badge>
        </header>
        {isLoading ? (
          <SkeletonList />
        ) : pipeline.length === 0 ? (
          <EmptyCard>Sem marcos próximos no pipeline.</EmptyCard>
        ) : (
          <ul className="space-y-2">
            {pipeline.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-border bg-card/40 p-5 text-body text-text-2">
      {children}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-12" />
      ))}
    </div>
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
    <li className="flex items-center justify-between gap-3 rounded bg-card border border-border p-3 hover:border-border-strong transition-colors">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', urgencyColor[urgency])} aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text-1">{label}</p>
          <p className="text-caption text-text-2">
            {new Date(alert.scheduledFor).toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <a
          href={link}
          className="rounded border border-border bg-card px-2.5 py-1 text-caption text-text-1 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          Abrir
        </a>
        <button
          type="button"
          onClick={() => dismiss.mutate({ id: alert.id })}
          className="rounded px-2.5 py-1 text-caption text-text-2 hover:bg-hover hover:text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          Dispensar
        </button>
      </div>
    </li>
  );
}
