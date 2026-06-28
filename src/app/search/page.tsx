'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

const EXAMPLES = [
  'reuniões sobre orçamento em março',
  'clientes que mencionaram restrição de prazo',
  'feedback negativo sobre a proposta',
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const search = trpc.search.natural.useMutation();

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-2 text-2xl font-bold">Busca em linguagem natural</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Pesquise atividades e e-mails sem decorar palavras-chave.
      </p>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.length >= 2) search.mutate({ query });
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Ex: "clientes que pediram desconto em abril"'
          className="flex-1 rounded border px-3 py-2"
        />
        <Button type="submit" disabled={query.length < 2 || search.isPending}>
          {search.isPending ? 'Buscando…' : 'Buscar'}
        </Button>
      </form>

      {!search.data && !search.isPending && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <p className="mb-2 text-xs font-medium uppercase text-neutral-700">Exemplos</p>
          <ul className="space-y-1 text-sm">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(ex);
                    search.mutate({ query: ex });
                  }}
                  className="text-blue-700 hover:underline"
                >
                  &ldquo;{ex}&rdquo;
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {search.error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700">{search.error.message}</p>
      )}

      {search.data && (
        <>
          <p className="mb-3 text-xs text-neutral-500">
            {search.data.hits.length} resultado(s) ·{' '}
            {search.data.mode === 'vector' ? 'busca semântica (pgvector)' : 'busca por palavras (tsvector)'}{' '}
            {search.data.reranked && '· reranqueado por IA'}
          </p>
          {search.data.hits.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
              Nenhum resultado. Tente reformular a busca.
            </p>
          ) : (
            <ul className="space-y-2">
              {search.data.hits.map((h) => (
                <li key={`${h.sourceType}-${h.sourceId}`} className="rounded-lg border border-neutral-200 bg-white p-3">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700">
                      {h.sourceType === 'activity' ? 'atividade' : 'e-mail'}
                    </span>
                    <span className="text-neutral-500">
                      {new Date(h.occurredAt).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <p className="mb-1 text-sm font-medium">{h.title}</p>
                  <p className="line-clamp-2 text-xs text-neutral-700">{h.snippet}</p>
                  {h.opportunityId && (
                    <a
                      href={`/pipeline/${h.opportunityId}`}
                      className="mt-1 inline-block text-xs text-blue-700 hover:underline"
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
    </main>
  );
}
