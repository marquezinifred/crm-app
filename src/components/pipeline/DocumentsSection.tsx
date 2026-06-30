'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { DocumentCategory } from '@prisma/client';

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  INSTITUCIONAL: 'Institucional',
  PROPOSTA_TECNICA: 'Proposta técnica',
  PROPOSTA_COMERCIAL: 'Proposta comercial',
  ORCAMENTO: 'Orçamento',
  CONTRATO: 'Contrato',
  NDA: 'NDA',
  TERMO_RESPONSABILIDADE: 'Termo de responsabilidade',
  ACEITE_CLIENTE: 'Aceite do cliente',
  OUTRO: 'Outro',
};

interface Props {
  opportunityId: string;
}

export function DocumentsSection({ opportunityId }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.documents.listByOpportunity.useQuery({ opportunityId });
  const [form, setForm] = useState({
    category: 'PROPOSTA_TECNICA' as DocumentCategory,
    filename: '',
    storageKey: '',
    sizeBytes: '',
    sha256: '',
  });

  const create = trpc.documents.create.useMutation({
    onSuccess: () => {
      setForm({ ...form, filename: '', storageKey: '', sizeBytes: '', sha256: '' });
      utils.documents.listByOpportunity.invalidate({ opportunityId });
    },
  });

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
        Documentos ({data?.length ?? 0})
      </h2>

      <details className="mb-3">
        <summary className="cursor-pointer text-sm font-medium text-text-1">
          + Anexar documento
        </summary>
        <form
          className="mt-3 space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              opportunityId,
              category: form.category,
              filename: form.filename,
              mimeType: form.filename.endsWith('.pdf')
                ? 'application/pdf'
                : 'application/octet-stream',
              sizeBytes: Number(form.sizeBytes) || 0,
              storageKey: form.storageKey,
              sha256: form.sha256,
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-0.5 block text-xs">Categoria</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as DocumentCategory })}
                className="w-full rounded border px-2 py-1"
              >
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-0.5 block text-xs">Nome do arquivo</span>
              <input
                required
                value={form.filename}
                onChange={(e) => setForm({ ...form, filename: e.target.value })}
                placeholder="proposta-v1.pdf"
                className="w-full rounded border px-2 py-1"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-0.5 block text-xs">URL/path do arquivo</span>
            <input
              required
              value={form.storageKey}
              onChange={(e) => setForm({ ...form, storageKey: e.target.value })}
              placeholder="https://drive.google.com/file/... ou s3://bucket/key"
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-0.5 block text-xs">Tamanho (bytes)</span>
              <input
                required
                type="number"
                value={form.sizeBytes}
                onChange={(e) => setForm({ ...form, sizeBytes: e.target.value })}
                className="w-full rounded border px-2 py-1"
              />
            </label>
            <label>
              <span className="mb-0.5 block text-xs">SHA-256</span>
              <input
                required
                value={form.sha256}
                onChange={(e) => setForm({ ...form, sha256: e.target.value })}
                placeholder="64 chars hex"
                className="w-full rounded border px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Salvando…' : 'Anexar'}
          </Button>
        </form>
      </details>

      {isLoading && <p className="text-sm text-text-2">Carregando…</p>}

      {data && data.length === 0 && (
        <p className="text-sm text-text-2">Sem documentos. Anexe a primeira proposta ou contrato.</p>
      )}

      <ul className="space-y-2">
        {data?.map((d) => (
          <li key={d.id} className="rounded border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{d.filename}</p>
                <p className="text-xs text-text-2">
                  {CATEGORY_LABELS[d.category]} · {d.versions.length} versão(ões)
                </p>
              </div>
              <span className="rounded bg-hover px-2 py-0.5 text-xs text-text-1">
                v{d.versions[0]?.version ?? 1}
              </span>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs">
              {d.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>
                    v{v.version} · {new Date(v.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                    {v.uploadedBy?.fullName ?? '—'}
                  </span>
                  <a
                    href={v.storageKey}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-info-text hover:underline"
                  >
                    abrir ↗
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
