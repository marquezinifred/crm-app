'use client';

import { useState } from 'react';
import { useIsMobile } from '@/lib/utils/hooks';
import { PipelineKanban } from '@/components/pipeline/PipelineKanban';
import { PipelineMobile } from '@/components/pipeline/PipelineMobile';

export default function PipelinePage() {
  const isMobile = useIsMobile();
  const [advanceError, setAdvanceError] = useState<{ msg: string; oppId: string } | null>(null);

  return (
    <main className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white px-4 py-3 md:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Pipeline</h1>
          <a
            href="/pipeline/new"
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + Nova oportunidade
          </a>
        </div>
      </header>

      {isMobile ? (
        <PipelineMobile
          onCardClick={(id) => (window.location.href = `/pipeline/${id}`)}
          onAdvanceError={(msg, oppId) => setAdvanceError({ msg, oppId })}
        />
      ) : (
        <div className="p-4 md:p-6">
          <PipelineKanban
            onCardClick={(id) => (window.location.href = `/pipeline/${id}`)}
            onAdvanceError={(msg, oppId) => setAdvanceError({ msg, oppId })}
          />
        </div>
      )}

      {advanceError && (
        <div
          role="alertdialog"
          aria-labelledby="advance-error-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setAdvanceError(null)}
        >
          <div
            className="max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="advance-error-title" className="mb-2 text-base font-semibold">
              Não foi possível avançar
            </h2>
            <p className="mb-4 whitespace-pre-line text-sm text-neutral-700">
              {advanceError.msg}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdvanceError(null)}
                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Fechar
              </button>
              <a
                href={`/pipeline/${advanceError.oppId}`}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
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
