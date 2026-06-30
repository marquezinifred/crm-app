'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { ImportEntity, ImportDedupStrategy, ImportStatus } from '@prisma/client';

interface UploadResult {
  id: string;
  headers: string[];
  preview: string[][];
  totalRows: number;
}

export default function ImportsPage() {
  const utils = trpc.useUtils();
  const { data: list } = trpc.imports.list.useQuery(undefined, { refetchInterval: 3000 });
  const [step, setStep] = useState<'upload' | 'map' | 'confirm'>('upload');
  const [entity, setEntity] = useState<ImportEntity>('COMPANY');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [strategy, setStrategy] = useState<ImportDedupStrategy>('IGNORE_DUPLICATES');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fieldsQ = trpc.imports.fields.useQuery({ entity });
  const confirm = trpc.imports.confirm.useMutation({
    onSuccess: () => {
      setStep('upload');
      setUploadResult(null);
      setMapping({});
      utils.imports.list.invalidate();
    },
  });

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    setUploading(true);
    try {
      const form = e.currentTarget;
      const fd = new FormData(form);
      fd.append('entity', entity);
      const res = await fetch('/api/v1/imports/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as UploadResult;
      setUploadResult(data);
      setMapping({});
      setStep('map');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Erro no upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">Importação de dados</h1>

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <ol className="mb-4 flex gap-1 text-xs">
          {[
            ['upload', '1. Enviar'],
            ['map', '2. Mapear'],
            ['confirm', '3. Confirmar'],
          ].map(([k, label]) => (
            <li
              key={k}
              className={`flex-1 rounded px-2 py-1 text-center ${
                step === k ? 'bg-brand text-white' : 'bg-hover'
              }`}
            >
              {label}
            </li>
          ))}
        </ol>

        {step === 'upload' && (
          <form onSubmit={handleUpload} className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-0.5 block text-xs">Entidade</span>
              <select
                value={entity}
                onChange={(e) => setEntity(e.target.value as ImportEntity)}
                className="w-full rounded border px-2 py-1"
              >
                <option value="COMPANY">Empresas</option>
                <option value="CONTACT">Contatos</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs">Arquivo (.csv ou .xlsx, máx 10 MB)</span>
              <input
                required
                name="file"
                type="file"
                accept=".csv,.xlsx,.tsv"
                className="w-full rounded border px-2 py-1"
              />
            </label>
            {uploadError && (
              <p className="rounded bg-red-50 p-2 text-sm text-danger">{uploadError}</p>
            )}
            <Button type="submit" disabled={uploading}>
              {uploading ? 'Enviando…' : 'Continuar'}
            </Button>
          </form>
        )}

        {step === 'map' && uploadResult && fieldsQ.data && (
          <div className="space-y-3">
            <p className="text-sm text-text-2">
              {uploadResult.totalRows} linha(s) detectada(s). Mapeie suas colunas para os campos
              do CRM:
            </p>
            <div className="space-y-2">
              {fieldsQ.data.map((field) => (
                <label key={field.name} className="flex items-center gap-3 text-sm">
                  <span className="w-48 shrink-0">
                    {field.label}
                    {field.required && <span className="text-danger"> *</span>}
                  </span>
                  <select
                    value={mapping[field.name] ?? ''}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        ...(e.target.value === ''
                          ? Object.fromEntries(Object.entries(mapping).filter(([k]) => k !== field.name))
                          : { [field.name]: Number(e.target.value) }),
                      })
                    }
                    className="flex-1 rounded border px-2 py-1"
                  >
                    <option value="">— ignorar —</option>
                    {uploadResult.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Coluna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <details className="rounded border border-border p-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Pré-visualização (10 primeiras linhas)
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {uploadResult.headers.map((h, i) => (
                        <th key={i} className="border border-border bg-page p-1 text-left">
                          {h || `Col ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadResult.preview.map((row, i) => (
                      <tr key={i}>
                        {row.map((v, j) => (
                          <td key={j} className="border border-border p-1">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep('upload')}>
                ← Voltar
              </Button>
              <Button type="button" onClick={() => setStep('confirm')}>
                Continuar →
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm' && uploadResult && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{uploadResult.totalRows}</strong> linhas serão processadas como{' '}
              <strong>{entity}</strong>.
            </p>
            <label className="block">
              <span className="mb-0.5 block text-xs">Estratégia para duplicatas</span>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as ImportDedupStrategy)}
                className="w-full rounded border px-2 py-1"
              >
                <option value="IGNORE_DUPLICATES">Ignorar duplicatas</option>
                <option value="UPDATE_EXISTING">Atualizar registro existente</option>
                <option value="CREATE_NEW">Criar novo (pode dar erro de chave única)</option>
              </select>
            </label>
            {confirm.error && (
              <p className="rounded bg-red-50 p-2 text-sm text-danger">{confirm.error.message}</p>
            )}
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep('map')}>
                ← Voltar
              </Button>
              <Button
                type="button"
                disabled={confirm.isPending}
                onClick={() =>
                  confirm.mutate({ id: uploadResult.id, mapping, strategy })
                }
              >
                {confirm.isPending ? 'Iniciando…' : 'Iniciar importação'}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-1">
          Histórico
        </h2>
        {list && list.length === 0 && (
          <p className="rounded border border-dashed border-border-strong p-4 text-center text-sm text-text-2">
            Sem importações ainda. Suba seu primeiro CSV ou XLSX.
          </p>
        )}
        <ul className="space-y-2">
          {list?.map((j) => {
            const result = j.resultJson as
              | { created?: number; updated?: number; skipped?: number; errors?: unknown[] }
              | null;
            return (
              <li key={j.id} className="rounded border border-border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {j.entity} · {j.fileName}
                    </p>
                    <p className="text-xs text-text-2">
                      {new Date(j.createdAt).toLocaleString('pt-BR')} ·{' '}
                      {j.processedRows}/{j.totalRows} linhas
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[j.status]}`}>
                    {j.status}
                  </span>
                </div>
                {result && (
                  <p className="mt-1 text-xs text-text-1">
                    ✓ {result.created ?? 0} criados · ↑ {result.updated ?? 0} atualizados · ⊘{' '}
                    {result.skipped ?? 0} ignorados · ✗ {result.errors?.length ?? 0} erros
                  </p>
                )}
                {j.errorMessage && <p className="mt-1 text-xs text-danger">{j.errorMessage}</p>}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

const STATUS_COLORS: Record<ImportStatus, string> = {
  PENDING: 'bg-hover text-text-1',
  PARSING: 'bg-info-bg text-info-text',
  MAPPED: 'bg-info-bg text-info-text',
  RUNNING: 'bg-warning-bg text-warning-text',
  DONE: 'bg-success-bg text-success-text',
  FAILED: 'bg-red-100 text-red-800',
};
