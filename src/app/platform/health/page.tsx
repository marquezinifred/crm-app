'use client';

import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function PlatformHealthPage() {
  const data = trpc.platform.health.today.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health Score"
        description="Visão CS/vendas: quem está em risco e quem está pronto pra upsell."
      />

      {data.isLoading && <p className="text-body text-text-2">Carregando…</p>}
      {data.data && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Bucket
            title="🔴 Em risco"
            description="Score < 40. Tendência de churn."
            items={data.data.byBucket.RED}
            variant="danger"
          />
          <Bucket
            title="🟡 Em alerta"
            description="Score 40–69. Vale uma ligação proativa."
            items={data.data.byBucket.YELLOW}
            variant="warning"
          />
          <Bucket
            title="🟢 Saudáveis"
            description="Score ≥ 70. Candidatos a upsell."
            items={data.data.byBucket.GREEN}
            variant="success"
          />
        </div>
      )}
    </div>
  );
}

type SnapshotWithTenant = {
  id: string;
  tenant: { id: string; name: string; slug: string; plan: string };
  healthScore: number;
  reasons: unknown;
};

function Bucket({
  title,
  description,
  items,
  variant,
}: {
  title: string;
  description: string;
  items: SnapshotWithTenant[];
  variant: 'danger' | 'warning' | 'success';
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <header className="mb-2">
        <h3 className="text-h3">{title}</h3>
        <p className="text-caption text-text-2">{description}</p>
      </header>
      {items.length === 0 ? (
        <p className="text-body text-text-3">Sem tenants neste bucket.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((s) => (
            <li key={s.id} className="py-2 flex items-baseline justify-between gap-2">
              <Link
                href={`/platform/tenants/${s.tenant.id}`}
                className="text-body text-brand-primary-light hover:underline truncate"
              >
                {s.tenant.name}
              </Link>
              <Badge variant={variant}>{s.healthScore}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
