/**
 * Versões correntes das políticas legais.
 * Cada nova versão exige novo aceite dos usuários ativos.
 */
export const POLICY_VERSIONS = {
  PRIVACY_POLICY: '2026-06-28',
  TERMS_OF_USE: '2026-06-28',
} as const;

export type LegalDocument = keyof typeof POLICY_VERSIONS;
