import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import localFont from 'next/font/local';
import { TrpcProvider } from '@/lib/trpc/provider';
import { AppShell } from '@/components/layout/AppShell';
import { PoweredByBadge } from '@/components/layout/PoweredByBadge';
import { CookieBanner } from '@/components/legal/CookieBanner';
import { TrialExpiryBanner } from '@/components/billing/TrialExpiryBanner';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui/toast';
import { resolveTenantTheme, buildBrandStyle } from '@/lib/theme/server';
import { googleFontsUrl } from '@/lib/theme/curated-fonts';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'CRM B2B',
  description: 'CRM comercial multi-tenant',
  applicationName: 'CRM B2B',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CRM',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const theme = await resolveTenantTheme();
  const brandStyle = buildBrandStyle(theme.themeConfig);
  const fontHref = googleFontsUrl(theme.themeConfig.fontFamily, [400, 500, 600, 700, 800]);

  return (
    <ClerkProvider>
      <html lang="pt-BR" suppressHydrationWarning style={brandStyle}>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={fontHref} />
        </head>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-page text-text-1 pb-16 md:pb-0`}
          style={{ fontFamily: 'var(--brand-font)' }}
        >
          <a href="#main-content" className="skip-link">Pular para conteúdo principal</a>
          <ThemeProvider>
            <TrpcProvider>
              <ToastProvider>
                <TrialExpiryBanner />
                <AppShell>{children}</AppShell>
              </ToastProvider>
            </TrpcProvider>
            <PoweredByBadge poweredBy={theme.poweredBy} />
            <CookieBanner />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
