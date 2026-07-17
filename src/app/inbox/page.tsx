'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/toast';

interface Suggestion {
  opportunityId: string;
  opportunityTitle: string;
  confidence: number;
  reason: string;
}

export default function InboxPage() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { data, isLoading, error } = trpc.inbox.list.useQuery({ status: 'PENDING' });
  const onMutationError = (err: { message: string }) =>
    toast({ kind: 'error', title: friendlyTrpcError(err) });
  const link = trpc.inbox.linkManually.useMutation({
    onSuccess: () => utils.inbox.list.invalidate(),
    onError: onMutationError,
  });
  const reject = trpc.inbox.reject.useMutation({
    onSuccess: () => utils.inbox.list.invalidate(),
    onError: onMutationError,
  });
  const retry = trpc.inbox.retryAutoLink.useMutation({
    onSuccess: () => utils.inbox.list.invalidate(),
    onError: onMutationError,
  });

  const opps = trpc.opportunities.list.useQuery({ page: 1, pageSize: 100, status: 'ACTIVE' });

  const [openId, setOpenId] = useState<string | null>(null);
  const [manualOppId, setManualOppId] = useState<Record<string, string>>({});

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title="Inbox"
        description="E-mails recebidos aguardando triagem."
        secondaryAction={
          <a href="/admin/email-inbound" className="text-sm text-text-2 hover:underline">
            Configurar endereço →
          </a>
        }
      />

      {isLoading && <p className="text-sm text-text-2">Carregando…</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {friendlyTrpcError(error)}
        </p>
      )}

      {data && data.length === 0 && (
        <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
          Sem e-mails pendentes. Envie um para o endereço inbound do seu tenant.
        </p>
      )}

      <ul className="space-y-2">
        {data?.map((e) => {
          const suggestions =
            ((e.rawPayload as { _suggestions?: Suggestion[] } | null)?._suggestions ?? []) as Suggestion[];
          const isOpen = openId === e.id;
          return (
            <li key={e.id} className="rounded-lg border border-border bg-card">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : e.id)}
                className="flex w-full items-start justify-between gap-3 p-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.subject ?? '(sem assunto)'}</p>
                  <p className="truncate text-xs text-text-2">de {e.fromEmail}</p>
                  <p className="text-xs text-text-2">
                    {new Date(e.receivedAt).toLocaleString('pt-BR')}
                  </p>
                </div>
                <span className="text-xs text-text-3">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-border p-3">
                  <div className="mb-3 max-h-48 overflow-y-auto rounded bg-page p-2 text-xs whitespace-pre-line">
                    {e.bodyText ?? '(corpo vazio)'}
                  </div>

                  {suggestions.length > 0 ? (
                    <div className="mb-3">
                      <p className="mb-1 text-xs font-medium text-text-1">Sugestões da IA</p>
                      <ul className="space-y-1">
                        {suggestions.map((s) => (
                          <li key={s.opportunityId} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">
                              {s.opportunityTitle}{' '}
                              <span className="text-xs text-text-2">
                                ({Math.round(s.confidence * 100)}%)
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={link.isLoading}
                              onClick={() =>
                                link.mutate({ id: e.id, opportunityId: s.opportunityId })
                              }
                            >
                              Vincular
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mb-3 text-xs text-text-2">
                      Sem sugestões automáticas dessa vez.
                    </p>
                  )}

                  <div className="mb-3 flex items-center gap-2">
                    <select
                      value={manualOppId[e.id] ?? ''}
                      onChange={(ev) =>
                        setManualOppId({ ...manualOppId, [e.id]: ev.target.value })
                      }
                      className="flex-1 rounded border px-2 py-1 text-sm"
                    >
                      <option value="">Vincular manualmente a…</option>
                      {opps.data?.rows.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      disabled={!manualOppId[e.id] || link.isLoading}
                      onClick={() =>
                        link.mutate({ id: e.id, opportunityId: manualOppId[e.id]! })
                      }
                    >
                      Vincular
                    </Button>
                  </div>

                  <div className="flex justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => retry.mutate({ id: e.id })}
                    >
                      Tentar IA novamente
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => reject.mutate({ id: e.id, reason: 'Não pertence a oportunidade' })}
                    >
                      Rejeitar
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
