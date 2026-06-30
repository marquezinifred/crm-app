'use client';

import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useEffect } from 'react';

export default function OnboardingSetupPage() {
  const utils = trpc.useUtils();
  const markComplete = trpc.onboarding.markCompleteIfDone.useMutation({
    onSuccess: () => utils.onboarding.progress.invalidate(),
  });

  useEffect(() => {
    markComplete.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-h1">Configure seu CRM</h1>
        <p className="text-body-lg text-text-2 mt-2 max-w-prose">
          Cada passo abaixo destrava uma parte do produto. Você pode voltar
          aqui a qualquer momento — seu progresso fica salvo.
        </p>
      </header>

      <OnboardingChecklist variant="full" />

      <footer className="pt-4 border-t border-border">
        <Link
          href="/dashboard"
          className="text-body text-brand-primary-light underline hover:text-brand-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded"
        >
          Ir para o dashboard →
        </Link>
      </footer>
    </main>
  );
}
