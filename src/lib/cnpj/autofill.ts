import type { CnpjData } from './lookup';

/**
 * Campos do CompanyForm que o autofill por CNPJ pode preencher.
 * Só sobrescrevemos quando o usuário ainda não digitou nada — o que
 * ele já preencheu manualmente sempre prevalece.
 */
export interface AutofillTarget {
  razaoSocial: string;
  nomeFantasia: string;
  state: string;
  city: string;
  phone: string;
}

export interface AutofillResult<T extends AutofillTarget> {
  next: T;
  filled: Array<keyof AutofillTarget>;
  preserved: Array<keyof AutofillTarget>;
}

/**
 * Mescla dados da BrasilAPI no estado do form preservando entradas
 * manuais. Retorna o estado novo + auditoria de quais campos foram
 * preenchidos e quais foram preservados (para UI mostrar toast).
 */
export function mergeCnpjAutofill<T extends AutofillTarget>(
  current: T,
  data: CnpjData,
): AutofillResult<T> {
  const next = { ...current };
  const filled: Array<keyof AutofillTarget> = [];
  const preserved: Array<keyof AutofillTarget> = [];

  const candidates: Array<[keyof AutofillTarget, string | null]> = [
    ['razaoSocial', data.razaoSocial],
    ['nomeFantasia', data.nomeFantasia],
    ['state', data.state],
    ['city', data.city],
    ['phone', data.phone],
  ];

  for (const [key, incoming] of candidates) {
    const value = incoming ?? '';
    if (!value) continue;
    if (current[key]?.toString().trim()) {
      if (current[key] !== value) preserved.push(key);
      continue;
    }
    (next as AutofillTarget)[key] = value;
    filled.push(key);
  }

  return { next, filled, preserved };
}
