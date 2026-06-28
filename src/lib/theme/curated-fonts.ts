/**
 * Fontes curadas para plano Growth — Google Fonts profissionais que
 * combinam com a identidade Venzo. Enterprise pode escolher qualquer
 * Google Font.
 */

export interface CuratedFont {
  family: string;
  weights: number[];
  category: 'sans-serif' | 'serif';
  description: string;
}

export const CURATED_FONTS: CuratedFont[] = [
  {
    family: 'Plus Jakarta Sans',
    weights: [400, 500, 600, 700, 800],
    category: 'sans-serif',
    description: 'Padrão Venzo. Geometria moderna, ótima legibilidade.',
  },
  {
    family: 'Inter',
    weights: [400, 500, 600, 700],
    category: 'sans-serif',
    description: 'Neutra, otimizada para interfaces digitais.',
  },
  {
    family: 'Manrope',
    weights: [400, 500, 600, 700, 800],
    category: 'sans-serif',
    description: 'Humanista com personalidade contemporânea.',
  },
  {
    family: 'DM Sans',
    weights: [400, 500, 700],
    category: 'sans-serif',
    description: 'Limpa, geométrica, profissional.',
  },
  {
    family: 'Outfit',
    weights: [400, 500, 600, 700, 800],
    category: 'sans-serif',
    description: 'Moderna e versátil, com toque elegante.',
  },
  {
    family: 'Public Sans',
    weights: [400, 500, 600, 700],
    category: 'sans-serif',
    description: 'Acessível por design, ótimo contraste.',
  },
];

export function isCuratedFont(family: string): boolean {
  return CURATED_FONTS.some((f) => f.family === family);
}

/**
 * Retorna URL de Google Fonts para a família + pesos.
 * Ex: https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap
 */
export function googleFontsUrl(family: string, weights: number[]): string {
  const familyParam = family.replace(/\s+/g, '+');
  const weightsParam = [...weights].sort((a, b) => a - b).join(';');
  return `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weightsParam}&display=swap`;
}
