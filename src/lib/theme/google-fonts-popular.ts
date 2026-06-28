/**
 * Lista das ~60 Google Fonts mais populares para uso em produto B2B.
 * Curada para incluir sans, serif e display de bom contraste e legibilidade.
 * Admin Enterprise pode digitar qualquer outra — a lista é apenas atalho.
 */
export const POPULAR_GOOGLE_FONTS: ReadonlyArray<{ family: string; category: 'sans' | 'serif' | 'display' | 'mono' }> = [
  // Sans — produto, UI, dashboards
  { family: 'Plus Jakarta Sans', category: 'sans' },
  { family: 'Inter', category: 'sans' },
  { family: 'Manrope', category: 'sans' },
  { family: 'DM Sans', category: 'sans' },
  { family: 'Outfit', category: 'sans' },
  { family: 'Public Sans', category: 'sans' },
  { family: 'Geist', category: 'sans' },
  { family: 'Sora', category: 'sans' },
  { family: 'Figtree', category: 'sans' },
  { family: 'Lexend', category: 'sans' },
  { family: 'Roboto', category: 'sans' },
  { family: 'Open Sans', category: 'sans' },
  { family: 'Lato', category: 'sans' },
  { family: 'Poppins', category: 'sans' },
  { family: 'Montserrat', category: 'sans' },
  { family: 'Nunito', category: 'sans' },
  { family: 'Nunito Sans', category: 'sans' },
  { family: 'Work Sans', category: 'sans' },
  { family: 'Source Sans 3', category: 'sans' },
  { family: 'IBM Plex Sans', category: 'sans' },
  { family: 'Mulish', category: 'sans' },
  { family: 'Rubik', category: 'sans' },
  { family: 'Karla', category: 'sans' },
  { family: 'Quicksand', category: 'sans' },
  { family: 'Heebo', category: 'sans' },
  { family: 'Hind', category: 'sans' },
  { family: 'PT Sans', category: 'sans' },
  { family: 'Noto Sans', category: 'sans' },
  { family: 'Barlow', category: 'sans' },
  { family: 'Cabin', category: 'sans' },
  { family: 'Fira Sans', category: 'sans' },
  { family: 'Oxygen', category: 'sans' },

  // Serif — institucional, premium, editorial
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'Source Serif 4', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Cormorant Garamond', category: 'serif' },
  { family: 'Bitter', category: 'serif' },
  { family: 'IBM Plex Serif', category: 'serif' },
  { family: 'Crimson Pro', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Spectral', category: 'serif' },
  { family: 'Noto Serif', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },

  // Display — headers, marca, hero
  { family: 'Space Grotesk', category: 'display' },
  { family: 'Archivo', category: 'display' },
  { family: 'Bricolage Grotesque', category: 'display' },
  { family: 'Onest', category: 'display' },
  { family: 'Albert Sans', category: 'display' },
  { family: 'Urbanist', category: 'display' },
  { family: 'Syne', category: 'display' },

  // Mono — código, IDs, dados técnicos
  { family: 'JetBrains Mono', category: 'mono' },
  { family: 'Fira Code', category: 'mono' },
  { family: 'IBM Plex Mono', category: 'mono' },
  { family: 'Source Code Pro', category: 'mono' },
  { family: 'Space Mono', category: 'mono' },
  { family: 'Roboto Mono', category: 'mono' },
];
