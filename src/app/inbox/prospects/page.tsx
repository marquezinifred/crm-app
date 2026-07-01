'use client';

import { useState, useMemo, useEffect } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';

/**
 * /inbox/prospects — Sprint 15D.
 *
 * Fila de leads inbound aguardando alocação. Ordenados por
 * inbound_received_at desc. Cards mostram empresa + contato + valor + AI
 * confidence badge. Botão "Alocar" abre Popover com vendedores ordenados
 * por carga asc.
 *
 * Acesso: apenas quem tem permission inbound:view_queue (GESTOR_INBOUND,
 * ADMIN, DIRETOR_COMERCIAL). tRPC devolve FORBIDDEN pra os outros.
 */

type SourceFilter = string | undefined;
type ConfidenceFilter = 'all' | 'high' | 'medium';

export default function ProspectsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(undefined);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [openAssignFor, setOpenAssignFor] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Sync highlight from ?highlight=... (push notification landing)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const h = params.get('highlight');
    if (h) setHighlightId(h);
  }, []);

  const minConfidence =
    confidenceFilter === 'high' ? 0.8 : confidenceFilter === 'medium' ? 0.4 : undefined;

  const queueQuery = trpc.inbound.queueList.useQuery({
    take: 100,
    ...(sourceFilter && { sourceFilter }),
    ...(minConfidence !== undefined && { minConfidence }),
  });

  const sellersQuery = trpc.inbound.sellersWithLoad.useQuery(undefined, {
    enabled: !!openAssignFor,
  });

  const assign = trpc.inbound.assignInbound.useMutation({
    onSuccess: () => {
      toast({ title: 'Lead alocado.', description: 'O vendedor foi notificado.', kind: 'success' });
      utils.inbound.queueList.invalidate();
      utils.inbound.queueCount.invalidate();
      setOpenAssignFor(null);
    },
    onError: (err) =>
      toast({
        title: 'Não foi possível alocar.',
        description: friendlyTrpcError(err),
        kind: 'error',
      }),
  });

  const prospects = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);

  // Deriva sources únicos pra filtro (dinâmico — não hardcode enum)
  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (const p of prospects) if (p.inboundSource) set.add(p.inboundSource);
    return Array.from(set).sort();
  }, [prospects]);

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHeader
        title={`Prospects inbound${prospects.length > 0 ? ` (${prospects.length})` : ''}`}
        description="Leads que chegaram automaticamente por formulário ou email. Aloque um vendedor pra começar a qualificação."
      />

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={sourceFilter ?? ''}
          onChange={(e) => setSourceFilter(e.target.value || undefined)}
          className="input h-9 max-w-[200px]"
          aria-label="Filtrar por origem"
        >
          <option value="">Todas as origens</option>
          {availableSources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={confidenceFilter}
          onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceFilter)}
          className="input h-9 max-w-[200px]"
          aria-label="Filtrar por confiança"
        >
          <option value="all">Toda confiança</option>
          <option value="high">Alta (≥ 0.8)</option>
          <option value="medium">Média (0.4 – 0.79)</option>
        </select>
      </div>

      {queueQuery.isLoading && (
        <p className="text-sm text-text-2">Carregando fila…</p>
      )}
      {queueQuery.error && (
        <p className="rounded-lg border border-danger bg-danger-bg p-3 text-sm text-danger-text">
          {friendlyTrpcError(queueQuery.error)}
        </p>
      )}

      {queueQuery.data && prospects.length === 0 && (
        <EmptyState
          title="Sem leads aguardando alocação."
          description="Bom trabalho, fila zerada. Quando chegar um lead novo pelo formulário ou webhook, ele aparece aqui."
        />
      )}

      <ul className="space-y-3">
        {prospects.map((p) => {
          const parsedBy = p.inboundParsedBy ?? 'manual';
          const isAi = parsedBy.startsWith('ai:');
          const isHighlighted = highlightId === p.id;
          const conf = p.inboundConfidence ? Number(p.inboundConfidence) : null;
          return (
            <li
              key={p.id}
              className={
                'rounded-lg border p-4 transition-colors ' +
                (isHighlighted
                  ? 'border-brand-primary bg-brand-primary/5'
                  : 'border-border bg-card')
              }
            >
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-h4 text-text-1">
                    {p.clientCompany.razaoSocial}
                  </h2>
                  {p.clientContact && (
                    <p className="mt-0.5 text-sm text-text-2">
                      {p.clientContact.fullName}
                      {p.clientContact.position && ` — ${p.clientContact.position}`}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {p.inboundReceivedAt && (
                    <span className="text-xs text-text-3">
                      {relativeTime(new Date(p.inboundReceivedAt))}
                    </span>
                  )}
                  <Badge variant={isAi ? 'primary' : 'success'} className="text-[10px]">
                    {isAi ? 'IA' : 'regex'}
                    {conf !== null && ` · ${(conf * 100).toFixed(0)}%`}
                  </Badge>
                </div>
              </div>

              {p.description && (
                <p className="mb-2 line-clamp-2 text-sm text-text-2">
                  {p.description}
                </p>
              )}

              <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-2">
                {p.estimatedValue && (
                  <span
                    className="tabular-nums text-brand-accent"
                    title={formatBRL(Number(p.estimatedValue))}
                  >
                    {formatBRLCompact(Number(p.estimatedValue))} estimado
                  </span>
                )}
                {p.expectedCloseDate && (
                  <span>Prev. {formatDate(new Date(p.expectedCloseDate))}</span>
                )}
                {p.clientContact?.email && (
                  <a
                    href={`mailto:${p.clientContact.email}`}
                    className="hover:text-brand-primary hover:underline"
                  >
                    {p.clientContact.email}
                  </a>
                )}
                {p.inboundSource && (
                  <span className="rounded bg-hover px-1.5 py-0.5">{p.inboundSource}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Popover
                  open={openAssignFor === p.id}
                  onOpenChange={(open) => setOpenAssignFor(open ? p.id : null)}
                >
                  <PopoverTrigger asChild>
                    <Button variant="primary" size="sm">
                      Alocar
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[280px]">
                    <p className="mb-3 text-sm font-medium">Escolha um vendedor</p>
                    {sellersQuery.isLoading && (
                      <p className="text-xs text-text-2">Carregando…</p>
                    )}
                    {sellersQuery.data && sellersQuery.data.length === 0 && (
                      <p className="text-xs text-text-2">
                        Nenhum vendedor ativo. Cadastre em Admin › Usuários.
                      </p>
                    )}
                    <ul className="max-h-64 space-y-1 overflow-y-auto">
                      {sellersQuery.data?.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() =>
                              assign.mutate({
                                opportunityId: p.id,
                                ownerId: s.id,
                              })
                            }
                            disabled={assign.isPending}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-50"
                          >
                            <span>
                              <span className="block">{s.fullName}</span>
                              <span className="text-[11px] text-text-3">{s.role}</span>
                            </span>
                            <span className="ml-2 text-[11px] text-text-3">
                              {s.activeOpps} ativos
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex justify-end">
                      <PopoverClose asChild>
                        <button type="button" className="text-xs text-text-3 hover:underline">
                          Cancelar
                        </button>
                      </PopoverClose>
                    </div>
                  </PopoverContent>
                </Popover>

                <a
                  href={`/pipeline/${p.id}`}
                  className="text-sm text-text-2 hover:text-brand-primary hover:underline"
                >
                  Ver detalhes →
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `há ${days}d`;
  return d.toLocaleDateString('pt-BR');
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
