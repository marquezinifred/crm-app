import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Venzo Design System — Sprint 14.
 *
 * Cada cor é exposta como `hsl(var(--*-h) var(--*-s) var(--*-l) / <alpha-value>)`
 * — formato exigido pelo Tailwind para que alpha modifiers (`bg-brand-primary/50`)
 * funcionem com CSS vars. Os canais H/S/L vêm de `globals.css` e podem ser
 * sobrescritos por tenant (white-label).
 */
const hsl = (token: string) =>
  `hsl(var(--${token}-h) var(--${token}-s) var(--${token}-l) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    screens: {
      sm: '375px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Venzo brand
        brand: {
          primary: hsl('brand-primary'),
          'primary-dark': hsl('brand-primary-dark'),
          'primary-mid': hsl('brand-primary-mid'),
          'primary-light': hsl('brand-primary-light'),
          'primary-pale': hsl('brand-primary-pale'),
          accent: hsl('brand-accent'),
        },
        // Semânticas
        success: { DEFAULT: hsl('success'), bg: hsl('success-bg'), text: hsl('success-text') },
        danger: { DEFAULT: hsl('danger'), bg: hsl('danger-bg'), text: hsl('danger-text') },
        warning: { DEFAULT: hsl('warning'), bg: hsl('warning-bg'), text: hsl('warning-text') },
        info: { DEFAULT: hsl('info'), bg: hsl('info-bg'), text: hsl('info-text') },
        // Superfícies
        page: hsl('bg-page'),
        card: hsl('bg-card'),
        hover: hsl('bg-hover'),
        // Texto
        'text-1': hsl('text-primary'),
        'text-2': hsl('text-secondary'),
        'text-3': hsl('text-muted'),
        // Bordas
        border: hsl('border'),
        'border-strong': hsl('border-strong'),
        // shadcn compat (telas pré-Sprint 14 continuam funcionando)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary-shad))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        8: 'var(--space-8)',
        12: 'var(--space-12)',
      },
      fontSize: {
        // Escala tipográfica Venzo
        display: ['48px', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '900' }],
        h1: ['32px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '800' }],
        h2: ['24px', { lineHeight: '1.25', fontWeight: '700' }],
        h3: ['18px', { lineHeight: '1.3', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '1.6' }],
        body: ['14px', { lineHeight: '1.5' }],
        caption: ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        label: ['11px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.08em' }],
        mono: ['13px', { lineHeight: '1.4' }],
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s infinite ease-in-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
