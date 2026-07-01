'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/PageHeader';

const EXAMPLES = [
  'reuniões sobre orçamento em março',
  'clientes que mencionaram restrição de prazo',
  'feedback negativo sobre a proposta',
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const search = trpc.search.natural.useMutation();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Buscar"
        description="Encontre atividades, e-mails e oportunidades sem decorar palavras-chave."
      />

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.length >= 2) search.mutate({ query });
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Ex: "clientes que pediram desconto em abril"'
          className="flex-1"
          aria-label="Termo de busca"
        />
        <Button type="submit" variant="primary" disabled={query.length < 2} loading={search.isPending}>
          {search.isPending ? 'Buscando…' : 'Buscar'}
        </Button>
      </form>

      {!search.data && !search.isPending && (
        <div className="rounded-lg border border-border bg-page p-4">
          <p className="mb-2 text-xs font-medium uppercase text-text-1">Exemplos</p>
          <ul className="space-y-1 text-sm">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(ex);
                    search.mutate({ query: ex });
                  }}
                  className="text-info-text hover:underline"
                >
                  &ldquo;{ex}&rdquo;
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {search.error && (
        <p className="rounded bg-red-50 p-2 text-sm text-danger">{friendlyTrpcError(search.error)}</p>
      )}

      {search.data && (
        <>
          <p className="mb-3 text-xs text-text-2">
            {search.data.hits.length} resultado(s) ·{' '}
            {search.data.mode === 'vector' ? 'busca semântica (pgvector)' : 'busca por palavras (tsvector)'}{' '}
            {search.data.reranked && '· reranqueado por IA'}
          </p>
          {search.data.hits.length === 0 ? (
            <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
              Sem resultados. Tente outras palavras ou amplie o filtro.
            </p>
          ) : (
            <ul className="space-y-2">
              {search.data.hits.map((h) => (
                <li key={`${h.sourceType}-${h.sourceId}`} className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="rounded bg-hover px-2 py-0.5 text-text-1">
                      {h.sourceType === 'activity' ? 'atividade' : 'e-mail'}
                    </span>
                    <span className="text-text-2">
                      {new Date(h.occurredAt).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <p className="mb-1 text-sm font-medium">{h.title}</p>
                  <p className="line-clamp-2 text-xs text-text-1">{h.snippet}</p>
                  {h.opportunityId && (
                    <a
                      href={`/pipeline/${h.opportunityId}`}
                      className="mt-1 inline-block text-xs text-info-text hover:underline"
                    >
                      ver oportunidade →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
