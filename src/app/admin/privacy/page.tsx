'use client';

import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';
import type { DataSubjectRequestStatus, DataSubjectRequestType } from '@prisma/client';
import { PageHeader } from '@/components/layout/PageHeader';

const TYPE_LABEL: Record<DataSubjectRequestType, string> = {
  ACCESS: 'Acesso',
  CORRECTION: 'Correção',
  DELETION: 'Eliminação',
  PORTABILITY: 'Portabilidade',
  OBJECTION: 'Oposição',
};

const STATUS_BADGE: Record<DataSubjectRequestStatus, string> = {
  PENDING: 'bg-warning-bg text-warning-text',
  IN_PROGRESS: 'bg-info-bg text-info-text',
  COMPLETED: 'bg-success-bg text-success-text',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export default function AdminPrivacyPage() {
  const utils = trpc.useUtils();
  const all = trpc.privacy.listAll.useQuery();
  const process = trpc.privacy.process.useMutation({
    onSuccess: () => utils.privacy.listAll.invalidate(),
  });
  const reject = trpc.privacy.reject.useMutation({
    onSuccess: () => utils.privacy.listAll.invalidate(),
  });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Solicitações LGPD"
        description="SLA ANPD: 15 dias entre submissão e conclusão. Itens em vermelho estão atrasados."
        meta={all.data && `${all.data.length} solicitaç${all.data.length === 1 ? 'ão' : 'ões'}`}
      />

      {all.isLoading && <p>Carregando...</p>}
      {all.data && all.data.length === 0 && (
        <p className="text-text-2">Sem solicitações LGPD em aberto.</p>
      )}

      <div className="space-y-3">
        {all.data?.map((req) => {
          const overdue =
            req.status !== 'COMPLETED' &&
            req.status !== 'REJECTED' &&
            new Date(req.dueAt) < new Date();
          return (
            <article
              key={req.id}
              className={`border rounded-md p-4 ${
                overdue ? 'border-danger/40 bg-danger-bg/40' : 'bg-card'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[req.status]}`}
                    >
                      {req.status}
                    </span>
                    <span className="text-xs font-medium text-text-1">
                      {TYPE_LABEL[req.requestType]}
                    </span>
                    {overdue && (
                      <span className="text-xs text-danger font-semibold">
                        ATRASADO
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-text-1">
                    {req.subjectName ?? '—'} ·{' '}
                    <span className="text-text-2">{req.subjectEmail}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-2">
                    Recebido {new Date(req.submittedAt).toLocaleDateString('pt-BR')}{' '}
                    · Vence {new Date(req.dueAt).toLocaleDateString('pt-BR')}
                  </div>
                  {req.description && (
                    <p className="mt-2 text-sm text-text-1">{req.description}</p>
                  )}
                  {req.rejectionReason && (
                    <p className="mt-2 text-xs text-danger">
                      Motivo da rejeição: {req.rejectionReason}
                    </p>
                  )}
                </div>
                {(req.status === 'PENDING' || req.status === 'IN_PROGRESS') && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => process.mutate({ id: req.id })}
                      disabled={process.isPending}
                      className="px-3 py-1.5 text-sm rounded-md bg-success text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Processar
                    </button>
                    <button
                      onClick={() => {
                        setRejecting(req.id);
                        setReason('');
                      }}
                      className="px-3 py-1.5 text-sm rounded-md border hover:bg-page"
                    >
                      Rejeitar
                    </button>
                  </div>
                )}
              </div>

              {rejecting === req.id && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Justificativa (mínimo 3 caracteres)"
                    rows={3}
                    className="w-full border rounded-md p-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={reason.length < 3 || reject.isPending}
                      onClick={async () => {
                        await reject.mutateAsync({ id: req.id, reason });
                        setRejecting(null);
                      }}
                      className="px-3 py-1.5 text-sm rounded-md bg-danger text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Confirmar rejeição
                    </button>
                    <button
                      onClick={() => setRejecting(null)}
                      className="px-3 py-1.5 text-sm rounded-md border hover:bg-page"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
