'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { STAGES, STAGE_LABELS } from '@/components/pipeline/types';
import type { OpportunityStage } from '@prisma/client';

export default function ConversionRatesPage() {
  const current = trpc.reports.conversionRates.useQuery();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [rates, setRates] = useState<Record<OpportunityStage, number> | null>(null);
  const [suggestion, setSuggestion] = useState<{
    source: string;
    rationale: string;
    rates: Record<OpportunityStage, number>;
  } | null>(null);

  useEffect(() => {
    if (current.data) setRates(current.data);
  }, [current.data]);

  const save = trpc.reports.updateConversionRates.useMutation({
    onSuccess: () => {
      utils.reports.conversionRates.invalidate();
      utils.reports.revenueProjection.invalidate();
      toast({ kind: 'success', title: 'Taxas de conversão salvas.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });
  const suggest = trpc.reports.suggestConversionRates.useMutation({
    onSuccess: (data) => setSuggestion(data),
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  if (!rates) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <PageHeader
        title="Taxas de conversão"
        description="Percentual esperado de oportunidades que avançam de cada estágio. Alimenta a projeção de receita em /reports."
      />

      <div className="mb-4 flex gap-2">
        <Button
          type="button"
          onClick={() => suggest.mutate()}
          disabled={suggest.isLoading}
          variant="outline"
        >
          {suggest.isLoading ? 'Analisando…' : 'Sugerir com IA'}
        </Button>
      </div>

      {suggestion && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-info-bg p-4">
          <p className="mb-1 text-xs font-medium uppercase text-blue-900">
            Sugestão ({suggestion.source})
          </p>
          <p className="mb-3 text-sm text-blue-900">{suggestion.rationale}</p>
          <table className="mb-3 w-full text-sm">
            <thead className="text-left text-xs uppercase text-info-text">
              <tr>
                <th>Estágio</th>
                <th className="text-right">Atual</th>
                <th className="text-right">Sugerida</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((s) => (
                <tr key={s} className="border-t border-blue-200">
                  <td className="py-1">{STAGE_LABELS[s]}</td>
                  <td className="text-right">{rates[s]}%</td>
                  <td className="text-right font-medium">{suggestion.rates[s]}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                setRates({ ...suggestion.rates });
                setSuggestion(null);
              }}
            >
              Aceitar sugestão
            </Button>
            <Button type="button" variant="outline" onClick={() => setSuggestion(null)}>
              Descartar
            </Button>
          </div>
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ rates });
        }}
      >
        {STAGES.map((s) => (
          <label key={s} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{STAGE_LABELS[s]}</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={rates[s]}
                onChange={(e) => setRates({ ...rates, [s]: Number(e.target.value) })}
                className="w-20 rounded border px-2 py-1 text-right"
                disabled={s === 'CONTRATO'}
              />
              <span className="text-sm text-text-2">%</span>
            </div>
          </label>
        ))}

        <Button type="submit" disabled={save.isLoading}>
          {save.isLoading ? 'Salvando…' : 'Salvar'}
        </Button>
      </form>
    </main>
  );
}
