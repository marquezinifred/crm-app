import type { ThemeConfig } from './types';

/**
 * 8 paletas curadas para plano Growth — harmonizadas com a identidade
 * Venzo (foco em violeta/azul como cor de ação, com acento dourado ou
 * âmbar). Cada paleta passa WCAG AA em todas as combinações descritas
 * no `wcag-validator.service.ts` (validadas manualmente).
 *
 * Fonte: brand guide Venzo seção 06 (matriz por plano).
 */

export interface CuratedPalette {
  id: string;
  name: string;
  description: string;
  config: Omit<ThemeConfig, 'fontFamily' | 'logoUrl'>;
}

export const CURATED_PALETTES: CuratedPalette[] = [
  {
    id: 'venzo-default',
    name: 'Venzo (padrão)',
    description: 'Identidade Venzo original — violeta com acento dourado',
    config: {
      primaryColor: '#7C3AED',
      primaryDark: '#3B1F6A',
      primaryLight: '#C084FC',
      accentColor: '#F5A623',
    },
  },
  {
    id: 'cobalt-amber',
    name: 'Cobalto e Âmbar',
    description: 'Azul corporativo com acento âmbar',
    config: {
      primaryColor: '#1D4ED8',
      primaryDark: '#1E3A8A',
      primaryLight: '#93C5FD',
      accentColor: '#D97706',
    },
  },
  {
    id: 'forest-amber',
    name: 'Floresta e Âmbar',
    description: 'Verde corporativo com acento âmbar',
    config: {
      primaryColor: '#047857',
      primaryDark: '#064E3B',
      primaryLight: '#6EE7B7',
      accentColor: '#D97706',
    },
  },
  {
    id: 'crimson-gold',
    name: 'Carmim e Dourado',
    description: 'Vermelho corporativo com acento dourado',
    config: {
      primaryColor: '#B91C1C',
      primaryDark: '#7F1D1D',
      primaryLight: '#FCA5A5',
      accentColor: '#CA8A04',
    },
  },
  {
    id: 'navy-coral',
    name: 'Marinho e Coral',
    description: 'Azul marinho profundo com toque coral',
    config: {
      primaryColor: '#1E40AF',
      primaryDark: '#0F1E4D',
      primaryLight: '#7FA8E8',
      accentColor: '#DC2626',
    },
  },
  {
    id: 'graphite-violet',
    name: 'Grafite e Violeta',
    description: 'Cinza grafite com acento violeta',
    config: {
      primaryColor: '#374151',
      primaryDark: '#111827',
      primaryLight: '#9CA3AF',
      accentColor: '#7C3AED',
    },
  },
  {
    id: 'teal-orange',
    name: 'Teal e Laranja',
    description: 'Azul-verde com acento laranja energético',
    config: {
      primaryColor: '#0F766E',
      primaryDark: '#134E4A',
      primaryLight: '#5EEAD4',
      accentColor: '#EA580C',
    },
  },
  {
    id: 'indigo-rose',
    name: 'Índigo e Rosa',
    description: 'Índigo elegante com acento rosa moderno',
    config: {
      primaryColor: '#4338CA',
      primaryDark: '#1E1B4B',
      primaryLight: '#A5B4FC',
      accentColor: '#DB2777',
    },
  },
];

export function isCuratedPalette(config: Omit<ThemeConfig, 'fontFamily' | 'logoUrl'>): boolean {
  return CURATED_PALETTES.some(
    (p) =>
      p.config.primaryColor.toLowerCase() === config.primaryColor.toLowerCase() &&
      p.config.primaryDark.toLowerCase() === config.primaryDark.toLowerCase() &&
      p.config.primaryLight.toLowerCase() === config.primaryLight.toLowerCase() &&
      p.config.accentColor.toLowerCase() === config.accentColor.toLowerCase(),
  );
}
