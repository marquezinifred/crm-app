'use client';

import { MaintenanceBanner } from './MaintenanceBanner';
import { PastDueBanner } from './PastDueBanner';
import { OfflineBanner } from './OfflineBanner';
import { BroadcastBanners } from './BroadcastBanners';

/**
 * Stack de banners contextuais — Sprint 14.5 + 15B.
 *
 * Ordem (mais relevante primeiro):
 *   1. Broadcasts da Plataforma (Sprint 15B — DB-driven, com targeting)
 *   2. Manutenção env-driven (legado, suprimido se há broadcasts)
 *   3. Past due (danger — billing crítico)
 *   4. Offline (warning — situacional)
 */
export function ContextBanners() {
  return (
    <div>
      <BroadcastBanners />
      <MaintenanceBanner />
      <PastDueBanner />
      <OfflineBanner />
    </div>
  );
}
