'use client';

import { MaintenanceBanner } from './MaintenanceBanner';
import { PastDueBanner } from './PastDueBanner';
import { OfflineBanner } from './OfflineBanner';

/**
 * Stack de banners contextuais — Sprint 14.5.
 *
 * Ordem importa (mais crítico primeiro):
 *   1. Manutenção programada (info — ops avisou)
 *   2. Past due (danger — billing crítico)
 *   3. Offline (warning — situacional)
 *
 * Cada banner controla a própria visibilidade — ContextBanners apenas
 * organiza a ordem visual.
 */
export function ContextBanners() {
  return (
    <div>
      <MaintenanceBanner />
      <PastDueBanner />
      <OfflineBanner />
    </div>
  );
}
