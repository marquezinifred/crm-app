'use client';

import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';
import type { DataSubjectRequestStatus, DataSubjectRequestType } from '@prisma/client';

const TYPE_LABEL: Record<DataSubjectRequestType, string> = {
  ACCESS: 'Acesso',
  CORRECTION: 'Correção',
  DELETION: 'Eliminação',
  PORTABILITY: 'Portabilidade',
  OBJECTION: 'Oposição',
};

const STATUS_BADGE: Record<DataSubjectRequestStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
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
    <main className="p-6 md:p-10 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Solicitações LGPD</h1>
        <p className="text-sm text-neutral-600">
          SLA ANPD: 15 dias entre submissão e conclusão. Itens em vermelho
          estão atrasados.
        </p>
      </header>

      {all.isLoading && <p>Carregando...</p>}
      {all.data && all.data.length === 0 && (
        <p className="text-neutral-500">Nenhuma solicitação.</p>
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
                overdue ? 'border-rose-300 bg-rose-50/40' : 'bg-white'
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
                    <span className="text-xs font-medium text-neutral-700">
                      {TYPE_LABEL[req.requestType]}
                    </span>
                    {overdue && (
                      <span className="text-xs text-rose-700 font-semibold">
                        ATRASADO
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-neutral-900">
                    {req.subjectName ?? '—'} ·{' '}
                    <span className="text-neutral-600">{req.subjectEmail}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Recebido {new Date(req.submittedAt).toLocaleDateString('pt-BR')}{' '}
                    · Vence {new Date(req.dueAt).toLocaleDateString('pt-BR')}
                  </div>
                  {req.description && (
                    <p className="mt-2 text-sm text-neutral-700">{req.description}</p>
                  )}
                  {req.rejectionReason && (
                    <p className="mt-2 text-xs text-rose-700">
                      Motivo da rejeição: {req.rejectionReason}
                    </p>
                  )}
                </div>
                {(req.status === 'PENDING' || req.status === 'IN_PROGRESS') && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => process.mutate({ id: req.id })}
                      disabled={process.isPending}
                      className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Processar
                    </button>
                    <button
                      onClick={() => {
                        setRejecting(req.id);
                        setReason('');
                      }}
                      className="px-3 py-1.5 text-sm rounded-md border hover:bg-neutral-50"
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
                      className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Confirmar rejeição
                    </button>
                    <button
                      onClick={() => setRejecting(null)}
                      className="px-3 py-1.5 text-sm rounded-md border hover:bg-neutral-50"
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
    </main>
  );
}
