'use client';

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

/**
 * Wrapper de next-themes — Sprint 14.
 *
 * Usa `attribute="data-theme"` para casar com os seletores em globals.css.
 * Default dark (identidade Venzo). `enableSystem` respeita prefers-color-scheme
 * caso o usuário nunca tenha escolhido.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
