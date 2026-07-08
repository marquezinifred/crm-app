'use client';

import { useState } from 'react';
import { useIsMobile } from '@/lib/utils/hooks';
import { trpc } from '@/lib/trpc/client';
import { PipelineKanban } from '@/components/pipeline/PipelineKanban';
import { PipelineMobile } from '@/components/pipeline/PipelineMobile';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  ScopeSwitcher,
  type PipelineScopePreference,
} from '@/components/pipeline/ScopeSwitcher';

export default function PipelinePage() {
  const isMobile = useIsMobile();
  const meQ = trpc.users.me.useQuery(undefined, { staleTime: 60_000 });
  const [advanceError, setAdvanceError] = useState<{ msg: string; oppId: string } | null>(null);
  const [scopePreference, setScopePreference] =
    useState<PipelineScopePreference | null>(null);

  const ownerFilter =
    scopePreference === 'MINE' && meQ.data?.id ? meQ.data.id : undefined;

  return (
    <main className="min-h-screen p-4 md:p-6">
      <PageHeader
        title="Pipeline"
        description="Oportunidades por estágio no funil de vendas."
        primaryAction={
          <a
            href="/pipeline/new"
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            + Nova oportunidade
          </a>
        }
      />

      <div className="mb-4 flex justify-end">
        <ScopeSwitcher onChange={setScopePreference} />
      </div>

      {isMobile ? (
        <PipelineMobile
          onCardClick={(id) => (window.location.href = `/pipeline/${id}`)}
          onAdvanceError={(msg, oppId) => setAdvanceError({ msg, oppId })}
          ownerFilter={ownerFilter}
        />
      ) : (
        <PipelineKanban
          onCardClick={(id) => (window.location.href = `/pipeline/${id}`)}
          onAdvanceError={(msg, oppId) => setAdvanceError({ msg, oppId })}
          ownerFilter={ownerFilter}
        />
      )}

      {advanceError && (
        <div
          role="alertdialog"
          aria-labelledby="advance-error-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAdvanceError(null)}
        >
          <div
            className="max-w-md rounded-lg bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="advance-error-title" className="mb-2 text-base font-semibold">
              Não foi possível avançar
            </h2>
            <p className="mb-4 whitespace-pre-line text-sm text-text-1">
              {advanceError.msg}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdvanceError(null)}
                className="rounded border border-border-strong bg-card px-3 py-1.5 text-sm hover:bg-page"
              >
                Fechar
              </button>
              <a
                href={`/pipeline/${advanceError.oppId}`}
                className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
              >
                Editar oportunidade
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
