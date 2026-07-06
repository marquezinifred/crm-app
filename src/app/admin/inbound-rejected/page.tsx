'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';

/**
 * P-30 — /admin/inbound-rejected
 *
 * Tela dedicada de revisão de leads inbound rejeitados. Sprint 15D
 * gravava rejects em `inbound_leads_rejected` mas só mostrava lado a
 * lado com created na tab Histórico de /admin/email-inbound.
 *
 * Aqui: filtro por reason, ver payload cru, promover (bypassa
 * confidence/blacklist) ou re-executar parser (útil pós-upgrade
 * do prompt IA) e descartar.
 */

type ReasonFilter =
  | 'all'
  | 'low_confidence'
  | 'blacklisted_domain'
  | 'parse_error'
  | 'no_signal'
  | 'rate_limited'
  | 'rate_limited_per_sender';

type StatusFilter = 'pending' | 'discarded' | 'promoted' | 'all';

const REASON_LABEL: Record<Exclude<ReasonFilter, 'all'>, string> = {
  low_confidence: 'Confiança baixa',
  blacklisted_domain: 'Domínio bloqueado',
  parse_error: 'Erro de parse',
  no_signal: 'Sem sinal',
  rate_limited: 'Rate limit (IP)',
  rate_limited_per_sender: 'Rate limit (remetente)',
};

function reasonVariant(reason: string): 'danger' | 'warning' | 'info' {
  if (reason.startsWith('blacklisted')) return 'danger';
  if (reason.startsWith('parse_error')) return 'warning';
  if (reason.startsWith('rate_limited')) return 'warning';
  return 'info';
}

function reasonLabel(reason: string): string {
  if (reason.startsWith('parse_error')) return REASON_LABEL.parse_error;
  return REASON_LABEL[reason as keyof typeof REASON_LABEL] ?? reason;
}

export default function InboundRejectedPage() {
  const [reason, setReason] = useState<ReasonFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listInput = useMemo(
    () => ({
      take: 50,
      ...(reason !== 'all' && { reason }),
      ...(status !== 'all' && { status }),
    }),
    [reason, status],
  );

  const listQuery = trpc.inbound.rejectedList.useQuery(listInput);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Inbound rejeitados"
        description="Leads que caíram fora do padrão. Revise, promova ou descarte."
      />

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium uppercase text-text-2" htmlFor="reason">
            Motivo
          </label>
          <Select
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as ReasonFilter)}
          >
            <option value="all">Todos</option>
            <option value="low_confidence">Confiança baixa</option>
            <option value="blacklisted_domain">Domínio bloqueado</option>
            <option value="parse_error">Erro de parse</option>
            <option value="no_signal">Sem sinal</option>
            <option value="rate_limited">Rate limit (IP)</option>
            <option value="rate_limited_per_sender">Rate limit (remetente)</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium uppercase text-text-2" htmlFor="status">
            Status
          </label>
          <Select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="pending">Pendentes</option>
            <option value="promoted">Promovidos</option>
            <option value="discarded">Descartados</option>
            <option value="all">Todos</option>
          </Select>
        </div>
      </section>

      {listQuery.isLoading ? (
        <p className="text-sm text-text-2">Carregando…</p>
      ) : listQuery.data && listQuery.data.length > 0 ? (
        <ul className="space-y-2">
          {listQuery.data.map((row) => (
            <RejectedRow
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === row.id ? null : row.id))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-2">
          Sem leads rejeitados. Fila limpa.
        </p>
      )}
    </main>
  );
}

// ═════════════════════════════════════════════════════════════════
// RejectedRow — card expansível com raw payload + ações
// ═════════════════════════════════════════════════════════════════

interface RejectedRow {
  id: string;
  source: string;
  reason: string;
  status: string;
  confidence: unknown;
  receivedAt: Date;
  rawPayload: unknown;
  parsedJson: unknown;
}

interface RowProps {
  row: RejectedRow;
  expanded: boolean;
  onToggle: () => void;
}

function RejectedRow({ row, expanded, onToggle }: RowProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [confirmPromoteOpen, setConfirmPromoteOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [retryPreview, setRetryPreview] = useState<{
    parsed: unknown;
    wouldPromote: boolean;
  } | null>(null);

  const promote = trpc.inbound.rejectedPromote.useMutation({
    onSuccess: (result) => {
      toast({
        kind: 'success',
        title: 'Lead promovido.',
        description: `Oportunidade ${result.opportunityId.slice(0, 8)}… criada.`,
      });
      utils.inbound.rejectedList.invalidate();
    },
    onError: (err) =>
      toast({ kind: 'error', title: 'Erro ao promover.', description: friendlyTrpcError(err) }),
  });

  const discard = trpc.inbound.rejectedDiscard.useMutation({
    onSuccess: () => {
      toast({ kind: 'success', title: 'Lead descartado.' });
      utils.inbound.rejectedList.invalidate();
    },
    onError: (err) =>
      toast({ kind: 'error', title: 'Erro ao descartar.', description: friendlyTrpcError(err) }),
  });

  const retry = trpc.inbound.rejectedRetryParser.useMutation({
    onSuccess: (result) => {
      setRetryPreview({ parsed: result.parsed, wouldPromote: result.wouldPromote });
      toast({
        kind: 'success',
        title: 'Parser re-executado.',
        description: result.wouldPromote
          ? 'Confiança suficiente pra promover.'
          : 'Ainda abaixo do limiar.',
      });
    },
    onError: (err) =>
      toast({ kind: 'error', title: 'Falha no retry.', description: friendlyTrpcError(err) }),
  });

  const confidence = row.confidence == null ? null : Number(row.confidence);
  const canAct = row.status === 'pending';

  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-hover"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={reasonVariant(row.reason)}>{reasonLabel(row.reason)}</Badge>
            <Badge variant="default">{row.source}</Badge>
            {row.status !== 'pending' && (
              <Badge variant={row.status === 'promoted' ? 'success' : 'default'}>
                {row.status === 'promoted' ? 'Promovido' : 'Descartado'}
              </Badge>
            )}
            {confidence !== null && (
              <span className="text-xs tabular-nums text-text-3">
                {(confidence * 100).toFixed(0)}%
              </span>
            )}
            <span className="text-xs text-text-3">
              {new Date(row.receivedAt).toLocaleString('pt-BR')}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-text-2">
            {previewFromPayload(row.rawPayload)}
          </p>
        </div>
        <span aria-hidden className="text-text-3">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-text-2">Raw payload</h3>
              <pre
                data-testid="raw-payload"
                className="max-h-64 overflow-auto rounded bg-hover p-2 text-xs"
              >
                {JSON.stringify(row.rawPayload, null, 2)}
              </pre>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-text-2">Parsed</h3>
              <pre
                data-testid="parsed-json"
                className="max-h-64 overflow-auto rounded bg-hover p-2 text-xs"
              >
                {row.parsedJson
                  ? JSON.stringify(row.parsedJson, null, 2)
                  : '(sem parsed — precisa Retry parser)'}
              </pre>
            </section>
          </div>

          {retryPreview && (
            <section className="mt-3 rounded border border-info bg-info-bg p-2 text-xs">
              <p className="mb-1 font-semibold text-info-text">Novo resultado do parser</p>
              <pre className="max-h-40 overflow-auto">
                {JSON.stringify(retryPreview.parsed, null, 2)}
              </pre>
              <p className="mt-1 text-text-2">
                {retryPreview.wouldPromote
                  ? 'Confiança ≥ 0.4 — pode promover diretamente.'
                  : 'Ainda abaixo do limiar. Promoção manual mesmo assim é possível.'}
              </p>
            </section>
          )}

          {canAct && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={promote.isPending || !row.parsedJson}
                title={
                  row.parsedJson
                    ? undefined
                    : 'Sem parsed. Rode "Retry parser" antes de promover.'
                }
                onClick={() => setConfirmPromoteOpen(true)}
              >
                Promover
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ id: row.id })}
              >
                {retry.isPending ? 'Executando…' : 'Retry parser'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={discard.isPending}
                onClick={() => setConfirmDiscardOpen(true)}
              >
                Descartar
              </Button>
            </div>
          )}

          <AlertDialog
            open={confirmPromoteOpen}
            onCancel={() => setConfirmPromoteOpen(false)}
            title="Promover lead?"
            description="Uma oportunidade será criada mesmo que a confiança esteja abaixo do limiar ou o domínio esteja bloqueado."
            confirmLabel="Promover"
            tone="primary"
            onConfirm={() => {
              promote.mutate({ id: row.id });
              setConfirmPromoteOpen(false);
            }}
          />
          <AlertDialog
            open={confirmDiscardOpen}
            onCancel={() => setConfirmDiscardOpen(false)}
            title="Descartar lead?"
            description="O registro fica no histórico como descartado. Não é possível desfazer."
            confirmLabel="Descartar"
            tone="danger"
            onConfirm={() => {
              discard.mutate({ id: row.id });
              setConfirmDiscardOpen(false);
            }}
          />
        </div>
      )}
    </li>
  );
}

function previewFromPayload(payload: unknown): string {
  if (payload == null) return '(sem payload)';
  if (typeof payload === 'string') return payload.slice(0, 120);
  if (typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.text === 'string') return p.text.slice(0, 120);
    if (typeof p.subject === 'string') return p.subject.slice(0, 120);
    try {
      return JSON.stringify(payload).slice(0, 120);
    } catch {
      return '(payload não-serializável)';
    }
  }
  return String(payload);
}
