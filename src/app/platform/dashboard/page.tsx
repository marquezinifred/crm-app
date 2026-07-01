'use client';

import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';

const PLAN_LABEL: Record<string, string> = {
  TRIAL: 'Trial',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

export default function PlatformDashboardPage() {
  const me = trpc.platform.me.useQuery();
  const data = trpc.platform.dashboard.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
        description={`Bem-vindo${me.data ? `, ${me.data.fullName.split(' ')[0]}` : ''}. Status da plataforma agora.`}
      />

      {data.isLoading && <p className="text-body text-text-2">Carregando métricas…</p>}
      {data.error && (
        <p role="alert" className="text-body text-danger">
          {friendlyTrpcError(data.error)}
        </p>
      )}

      {data.data && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Tenants ativos"
              value={data.data.tenants.total.toLocaleString('pt-BR')}
              sub={
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(data.data.tenants.byPlan).map(([plan, count]) => (
                    <Badge key={plan} variant="default">
                      {PLAN_LABEL[plan] ?? plan}: {count}
                    </Badge>
                  ))}
                </div>
              }
            />
            <KpiCard
              label="MRR estimado"
              value={formatBRLCompact(data.data.mrrBrl)}
              sub={
                <span className="text-caption text-text-3">
                  {formatBRL(data.data.mrrBrl)} / mês
                </span>
              }
              accent
            />
            <KpiCard
              label="Trials expirando em 7d"
              value={data.data.trialsExpiring7d.toLocaleString('pt-BR')}
              sub={
                <span className="text-caption text-text-3">
                  Risco de churn — engajar antes do vencimento.
                </span>
              }
              warn={data.data.trialsExpiring7d > 0}
            />
            <KpiCard
              label="Tokens IA · mês corrente"
              value={data.data.aiTokensMonth.toLocaleString('pt-BR')}
              sub={
                <span className="text-caption text-text-3">
                  Custo aproximado: US$ {data.data.aiCostUsdMonth.toFixed(2)}
                </span>
              }
            />
            <KpiCard
              label="Privacy Requests"
              value={data.data.privacyRequestsPending.toLocaleString('pt-BR')}
              sub={
                <span className="text-caption text-text-3">
                  Pendentes ou em andamento (LGPD).
                </span>
              }
              warn={data.data.privacyRequestsPending > 0}
            />
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-h3 mb-2">Próximos passos sugeridos</h2>
            <ul className="text-body text-text-2 list-disc pl-5 space-y-1">
              {data.data.trialsExpiring7d > 0 && (
                <li>
                  Falar com {data.data.trialsExpiring7d} tenants em trial — risco real
                  de churn nos próximos 7 dias.
                </li>
              )}
              {data.data.privacyRequestsPending > 0 && (
                <li>
                  Processar {data.data.privacyRequestsPending} pedidos LGPD na fila
                  cross-tenant — SLA ANPD 15 dias.
                </li>
              )}
              <li>
                Ver lista completa de tenants em <code>/platform/tenants</code>.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
  warn,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-label text-text-3 mb-1">{label}</div>
      <div
        className={`text-h1 leading-none font-mono tabular-nums ${
          accent ? 'text-brand-accent' : warn ? 'text-danger' : 'text-text-1'
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-2">{sub}</div>}
    </div>
  );
}
