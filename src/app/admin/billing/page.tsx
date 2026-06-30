'use client';

import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';

function fmtBytes(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

function fmtLimit(v: number, formatter: (n: number) => string = (n) => n.toLocaleString('pt-BR')) {
  return v === Number.POSITIVE_INFINITY ? 'ilimitado' : formatter(v);
}

function UsageBar({ pct, exceeded }: { pct: number; exceeded: boolean }) {
  const color = exceeded
    ? 'bg-danger'
    : pct > 0.8
      ? 'bg-warning'
      : 'bg-success';
  return (
    <div className="h-2 rounded-full bg-hover overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct * 100).toFixed(0)}%` }} />
    </div>
  );
}

export default function BillingPage() {
  const status = trpc.billing.status.useQuery();
  const usage = trpc.billing.currentUsage.useQuery();
  const history = trpc.billing.history.useQuery();
  const checkout = trpc.billing.startCheckout.useMutation();
  const portal = trpc.billing.openPortal.useMutation();
  const [busy, setBusy] = useState<string | null>(null);

  async function upgrade(plan: 'STARTER' | 'PRO' | 'ENTERPRISE') {
    setBusy(plan);
    try {
      const { url } = await checkout.mutateAsync({ plan });
      window.location.href = url;
    } finally {
      setBusy(null);
    }
  }

  async function manage() {
    setBusy('portal');
    try {
      const { url } = await portal.mutateAsync();
      window.location.href = url;
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Plano e cobrança</h1>
        <p className="text-sm text-text-2">
          Gerencie seu plano, métodos de pagamento e veja o consumo atual.
        </p>
      </header>

      <section className="border rounded-lg p-5 bg-card">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase text-text-2 tracking-wide">Plano atual</div>
            <div className="text-2xl font-semibold mt-1">
              {status.data?.plan ?? '—'}
            </div>
            {status.data?.subscriptionStatus && (
              <div className="text-xs mt-1 text-text-2">
                Status Stripe: {status.data.subscriptionStatus}
                {status.data.currentPeriodEnd && (
                  <> · renova em {new Date(status.data.currentPeriodEnd).toLocaleDateString('pt-BR')}</>
                )}
              </div>
            )}
            {status.data?.trialEndsAt && (
              <div className="text-xs mt-0.5 text-warning-text">
                Trial termina em {new Date(status.data.trialEndsAt).toLocaleDateString('pt-BR')}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {status.data?.stripeCustomerId && (
              <button
                onClick={manage}
                disabled={busy === 'portal'}
                className="px-4 py-2 rounded-md border hover:bg-page disabled:opacity-50"
              >
                {busy === 'portal' ? 'Abrindo...' : 'Gerenciar pagamento'}
              </button>
            )}
          </div>
        </div>
        {!status.data?.stripeConfigured && (
          <p className="mt-3 text-xs text-warning-text">
            Stripe não está configurado neste ambiente. Configure
            STRIPE_SECRET_KEY + STRIPE_PRICE_* para habilitar upgrade.
          </p>
        )}
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        {(['STARTER', 'PRO', 'ENTERPRISE'] as const).map((plan) => (
          <article key={plan} className="border rounded-lg p-5 bg-card">
            <div className="text-base font-semibold">{plan}</div>
            <ul className="text-sm text-text-1 mt-3 space-y-1">
              {plan === 'STARTER' && (
                <>
                  <li>10 usuários</li>
                  <li>500 empresas, 2.000 contatos</li>
                  <li>1 GB de storage</li>
                </>
              )}
              {plan === 'PRO' && (
                <>
                  <li>50 usuários</li>
                  <li>5.000 empresas, 25.000 contatos</li>
                  <li>White-label + relatórios avançados</li>
                  <li>API pública</li>
                </>
              )}
              {plan === 'ENTERPRISE' && (
                <>
                  <li>Usuários ilimitados</li>
                  <li>Volume ilimitado</li>
                  <li>Override WCAG + Powered by oculto</li>
                  <li>SLA dedicado</li>
                </>
              )}
            </ul>
            <button
              onClick={() => upgrade(plan)}
              disabled={busy === plan || !status.data?.stripeConfigured || status.data?.plan === plan}
              className="mt-4 w-full px-4 py-2 rounded-md bg-brand text-white hover:opacity-90 disabled:opacity-50"
            >
              {status.data?.plan === plan
                ? 'Plano atual'
                : busy === plan
                  ? 'Redirecionando...'
                  : `Mudar para ${plan}`}
            </button>
          </article>
        ))}
      </section>

      <section className="border rounded-lg p-5 bg-card space-y-4">
        <h2 className="text-lg font-semibold">Uso atual</h2>
        {usage.isLoading && <p className="text-sm">Carregando...</p>}
        {usage.data && (
          <div className="space-y-4">
            {([
              ['Usuários ativos', usage.data.checks.users, (n) => n.toLocaleString('pt-BR')],
              ['Empresas', usage.data.checks.companies, (n) => n.toLocaleString('pt-BR')],
              ['Contatos', usage.data.checks.contacts, (n) => n.toLocaleString('pt-BR')],
              ['Storage', usage.data.checks.storage, fmtBytes],
              ['Tokens IA (mês)', usage.data.checks.aiTokens, (n) => n.toLocaleString('pt-BR')],
            ] as Array<[string, typeof usage.data.checks.users, (n: number) => string]>).map(
              ([label, ch, fmt]) => (
                <div key={label}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{label}</span>
                    <span className={ch.exceeded ? 'text-danger' : 'text-text-2'}>
                      {fmt(ch.current)} / {fmtLimit(ch.limit, fmt)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <UsageBar pct={ch.pct} exceeded={ch.exceeded} />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      <section className="border rounded-lg p-5 bg-card">
        <h2 className="text-lg font-semibold mb-3">Histórico de eventos</h2>
        {history.data && history.data.length === 0 && (
          <p className="text-sm text-text-2">Sem eventos de cobrança por enquanto.</p>
        )}
        <ul className="text-sm divide-y">
          {history.data?.map((ev) => (
            <li key={ev.id} className="py-2 flex justify-between gap-3">
              <span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-hover">
                  {ev.type}
                </span>
                {ev.error && <span className="ml-2 text-danger text-xs">erro: {ev.error}</span>}
              </span>
              <span className="text-text-2 text-xs">
                {new Date(ev.processedAt).toLocaleString('pt-BR')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
