'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

/**
 * Checklist de configuração — Sprint 13 + Sprint 14 (design tokens).
 *
 * `compact`: card no /dashboard (dispensável).
 * `full`: página /onboarding/setup com descrições.
 */
export function OnboardingChecklist({
  variant = 'compact',
}: {
  variant?: 'compact' | 'full';
}) {
  const utils = trpc.useUtils();
  const progress = trpc.onboarding.progress.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const dismiss = trpc.onboarding.dismissTour.useMutation({
    onSuccess: () => utils.onboarding.progress.invalidate(),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!progress.data) return null;
  if (progress.data.setupCompletedAt) return null;
  if (variant === 'compact' && progress.data.tourDismissedAt) return null;

  const { steps, completedCount, totalCount } = progress.data;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <section
      aria-label="Progresso de configuração"
      className="rounded-md border border-border bg-card p-5"
    >
      <header className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-h3 text-text-1">Configure seu CRM</h2>
          <p className="text-caption text-text-2 mt-0.5">
            {completedCount} de {totalCount} passos concluídos · {pct}%
          </p>
        </div>
        {variant === 'compact' && (
          <button
            onClick={() => setConfirmOpen(true)}
            className="text-caption text-text-3 hover:text-text-1 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded"
          >
            Dispensar
          </button>
        )}
      </header>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${pct}% concluído`}
        className="h-2 rounded-full bg-hover overflow-hidden mb-4"
      >
        <div
          className="h-full bg-brand-primary transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul role="list" className="space-y-0.5">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              aria-disabled={!s.available}
              className="flex items-start gap-3 p-2 rounded hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <span
                aria-label={s.done ? 'Concluído' : 'Pendente'}
                className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold shrink-0 ${
                  s.done
                    ? 'bg-success/15 text-success-text'
                    : 'border border-border text-text-3'
                }`}
              >
                {s.done ? '✓' : ''}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`text-[14px] font-medium ${s.done ? 'text-text-3 line-through' : 'text-text-1'}`}>
                  {s.label}
                </span>
                {variant === 'full' && (
                  <span className="block text-caption text-text-2 mt-0.5">{s.description}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Ocultar este checklist?"
        description="Você poderá rever em /onboarding/setup a qualquer momento."
        size="sm"
      >
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => {
              dismiss.mutate();
              setConfirmOpen(false);
            }}
          >
            Dispensar
          </Button>
        </ModalFooter>
      </Modal>
    </section>
  );
}
