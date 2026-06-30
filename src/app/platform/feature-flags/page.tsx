'use client';

import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';

export default function PlatformFeatureFlagsPage() {
  const list = trpc.platform.featureFlagsList.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature flags"
        description="Wrapper sobre o Unleash self-hosted. Por tenant override entra em sprint posterior."
      />

      <ul className="divide-y divide-border bg-card border border-border rounded-md">
        {list.data?.map((f) => (
          <li key={f.name} className="px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-medium text-text-1 font-mono">{f.name}</p>
              <p className="text-caption text-text-2">{f.description}</p>
            </div>
            <Badge variant={f.enabled ? 'success' : 'default'}>
              {f.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </li>
        ))}
      </ul>

      <p className="text-caption text-text-3">
        Para overrides por tenant, edite em <code>/platform/tenants/[id]</code> aba
        Configurações (em construção) ou direto no painel Unleash.
      </p>
    </div>
  );
}
