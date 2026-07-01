'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { FileDropzone, type FileMetadata } from '@/components/ui/file-dropzone';
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

const DOC_ACCEPT =
  '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*';
const DOC_MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  opportunityId: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function DocumentsSection({ opportunityId }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.documents.listByOpportunity.useQuery({ opportunityId });
  const [category, setCategory] = useState<DocumentCategory>('PROPOSTA_TECNICA');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getUploadIntent = trpc.documents.getUploadIntent.useMutation();
  const uploadProxy = trpc.documents.uploadProxy.useMutation();
  const create = trpc.documents.create.useMutation({
    onSuccess: () => {
      utils.documents.listByOpportunity.invalidate({ opportunityId });
    },
  });

  async function handleFileSelected(meta: FileMetadata) {
    setError(null);
    setUploading(true);
    try {
      const { storageKey } = await getUploadIntent.mutateAsync({
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
      });
      const contentBase64 = await fileToBase64(meta.file);
      await uploadProxy.mutateAsync({
        storageKey,
        contentBase64,
        mimeType: meta.mimeType,
      });
      await create.mutateAsync({
        opportunityId,
        category,
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        storageKey,
        sha256: meta.sha256,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Falha ao enviar arquivo.',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
        Documentos ({data?.length ?? 0})
      </h2>

      <details className="mb-3">
        <summary className="cursor-pointer text-sm font-medium text-text-1">
          + Anexar documento
        </summary>
        <div className="mt-3 space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-text-2">Categoria</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DocumentCategory)}
              disabled={uploading}
              className="w-full rounded border border-border bg-card px-2 py-1"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>

          <FileDropzone
            accept={DOC_ACCEPT}
            maxSizeBytes={DOC_MAX_BYTES}
            disabled={uploading}
            hint="PDF, DOCX, XLSX ou imagem até 20 MB"
            onFileSelected={handleFileSelected}
          />

          {uploading && (
            <p className="text-xs text-text-2">Enviando arquivo…</p>
          )}
          {error && (
            <p role="alert" className="rounded bg-danger/10 p-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
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
                  <span className="font-mono text-[10px] text-text-3" title={v.storageKey}>
                    {v.sha256.slice(0, 8)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
