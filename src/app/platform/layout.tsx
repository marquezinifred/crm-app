import { PlatformShell } from '@/components/platform/PlatformShell';

/**
 * Layout do console — Sprint 15A.
 *
 * Não usa o AppShell padrão (sidebar tenant + BottomNav + ContextBanners).
 * O middleware já bloqueia a rota se o caller não for PLATFORM_OWNER,
 * então aqui só envelopamos com o PlatformShell.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
