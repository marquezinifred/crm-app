'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/empty-state';
import { FileDropzone, type FileMetadata } from '@/components/ui/file-dropzone';
import { useToast } from '@/components/ui/toast';
import { DocumentCategory } from '@prisma/client';

const CATEGORIES: DocumentCategory[] = [
  'INSTITUCIONAL',
  'PROPOSTA_TECNICA',
  'PROPOSTA_COMERCIAL',
  'ORCAMENTO',
  'CONTRATO',
  'NDA',
  'TERMO_RESPONSABILIDADE',
  'ACEITE_CLIENTE',
  'OUTRO',
];

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  INSTITUCIONAL: 'Institucional',
  PROPOSTA_TECNICA: 'Proposta técnica',
  PROPOSTA_COMERCIAL: 'Proposta comercial',
  ORCAMENTO: 'Orçamento / planilha',
  CONTRATO: 'Contrato',
  NDA: 'NDA',
  TERMO_RESPONSABILIDADE: 'Termo de responsabilidade',
  ACEITE_CLIENTE: 'Aceite do cliente',
  OUTRO: 'Outro',
};

const TEMPLATE_ACCEPT =
  '.pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;

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

export default function AdminTemplatesPage() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const listQ = trpc.templates.list.useQuery({ activeOnly: false });
  const data = listQ.data;

  const [category, setCategory] = useState<DocumentCategory>('PROPOSTA_TECNICA');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingFilename, setPendingFilename] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const getUploadIntent = trpc.documents.getUploadIntent.useMutation();
  const uploadProxy = trpc.documents.uploadProxy.useMutation();
  const create = trpc.templates.create.useMutation({
    onSuccess: () => {
      setName('');
      setDescription('');
      setPendingKey(null);
      setPendingFilename(null);
      utils.templates.list.invalidate();
      toast({ kind: 'success', title: 'Template adicionado.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  async function handleFileSelected(meta: FileMetadata) {
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
      setPendingKey(storageKey);
      setPendingFilename(meta.filename);
    } catch (err) {
      const title =
        err && typeof err === 'object' && 'message' in err
          ? friendlyTrpcError(err as { message: string })
          : 'Falha ao enviar arquivo.';
      toast({ kind: 'error', title });
    } finally {
      setUploading(false);
    }
  }

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: (data ?? []).filter((t) => t.category === cat),
  })).filter((g) => g.items.length > 0);

  // P-92b — query adminOnly (P-91): não-admin recebe 403. Sem esse
  // branch a tela mostrava "Sem templates" silenciosamente.
  if (listQ.error && !data) {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader
          title="Templates"
          description="Modelos de proposta, contrato, NDA e outros — organizados por categoria."
        />
        <ErrorState
          title="Não foi possível carregar os templates."
          description={friendlyTrpcError(listQ.error)}
          onRetry={() => void listQ.refetch()}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title="Templates"
        description="Modelos de proposta, contrato, NDA e outros — organizados por categoria."
      />

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
          Adicionar template
        </h2>
        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              category,
              name,
              description: description || undefined,
              storageKey: pendingKey ?? undefined,
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-0.5 block text-xs text-text-2">Categoria</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                className="w-full rounded border border-border bg-card px-2 py-1"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-0.5 block text-xs text-text-2">Nome</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                className="w-full rounded border border-border bg-card px-2 py-1"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-0.5 block text-xs text-text-2">Descrição</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-border bg-card px-2 py-1"
            />
          </label>

          <div>
            <span className="mb-1 block text-xs text-text-2">
              Arquivo do template (opcional)
            </span>
            <FileDropzone
              accept={TEMPLATE_ACCEPT}
              maxSizeBytes={TEMPLATE_MAX_BYTES}
              disabled={uploading || create.isPending}
              hint="PDF, DOCX ou XLSX até 20 MB"
              onFileSelected={handleFileSelected}
            />
            {uploading && (
              <p className="mt-1 text-xs text-text-2">Enviando arquivo…</p>
            )}
            {pendingKey && pendingFilename && !uploading && (
              <p className="mt-1 text-xs text-success-text">
                ✓ {pendingFilename} pronto para salvar
              </p>
            )}
          </div>

          <Button type="submit" disabled={create.isPending || uploading}>
            {create.isPending ? 'Criando…' : 'Adicionar'}
          </Button>
        </form>
      </section>

      {grouped.length === 0 ? (
        <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
          Sem templates. Crie o primeiro para acelerar propostas e contratos.
        </p>
      ) : (
        grouped.map((g) => (
          <section key={g.category} className="mb-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-1">
              {CATEGORY_LABELS[g.category]}
            </h2>
            <ul className="space-y-1">
              {g.items.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded border border-border bg-card p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-text-2">{t.description}</p>
                    )}
                    {t.currentVersionStorageKey && (
                      <p className="font-mono text-[10px] text-text-3" title={t.currentVersionStorageKey}>
                        v{t.currentVersionNumber} · {t.currentVersionStorageKey.slice(-32)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-text-2">
                    {t.active ? 'ativo' : 'inativo'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
