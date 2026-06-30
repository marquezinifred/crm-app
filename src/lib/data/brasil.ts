/**
 * Estados brasileiros e hook de cidades (IBGE Localidades API).
 *
 * UFs são lista estática — não mudam. Municípios mudam raramente
 * (fusões / desmembramentos eventuais), o cache `staleTime: Infinity`
 * é seguro pela vida da sessão. A API IBGE é pública, sem auth.
 *
 * Sprint 15C — usada por CompanyForm e demais cadastros que pedem
 * endereço BR.
 */

import { useQuery } from '@tanstack/react-query';

export interface UF {
  uf: string;
  nome: string;
}

export const ESTADOS_BR: ReadonlyArray<UF> = Object.freeze([
  { uf: 'AC', nome: 'Acre' },
  { uf: 'AL', nome: 'Alagoas' },
  { uf: 'AP', nome: 'Amapá' },
  { uf: 'AM', nome: 'Amazonas' },
  { uf: 'BA', nome: 'Bahia' },
  { uf: 'CE', nome: 'Ceará' },
  { uf: 'DF', nome: 'Distrito Federal' },
  { uf: 'ES', nome: 'Espírito Santo' },
  { uf: 'GO', nome: 'Goiás' },
  { uf: 'MA', nome: 'Maranhão' },
  { uf: 'MT', nome: 'Mato Grosso' },
  { uf: 'MS', nome: 'Mato Grosso do Sul' },
  { uf: 'MG', nome: 'Minas Gerais' },
  { uf: 'PA', nome: 'Pará' },
  { uf: 'PB', nome: 'Paraíba' },
  { uf: 'PR', nome: 'Paraná' },
  { uf: 'PE', nome: 'Pernambuco' },
  { uf: 'PI', nome: 'Piauí' },
  { uf: 'RJ', nome: 'Rio de Janeiro' },
  { uf: 'RN', nome: 'Rio Grande do Norte' },
  { uf: 'RS', nome: 'Rio Grande do Sul' },
  { uf: 'RO', nome: 'Rondônia' },
  { uf: 'RR', nome: 'Roraima' },
  { uf: 'SC', nome: 'Santa Catarina' },
  { uf: 'SP', nome: 'São Paulo' },
  { uf: 'SE', nome: 'Sergipe' },
  { uf: 'TO', nome: 'Tocantins' },
]);

export const PAISES = [
  { code: 'BR', nome: 'Brasil' },
  { code: 'AR', nome: 'Argentina' },
  { code: 'CL', nome: 'Chile' },
  { code: 'CO', nome: 'Colômbia' },
  { code: 'MX', nome: 'México' },
  { code: 'PE', nome: 'Peru' },
  { code: 'UY', nome: 'Uruguai' },
  { code: 'PY', nome: 'Paraguai' },
  { code: 'US', nome: 'Estados Unidos' },
  { code: 'CA', nome: 'Canadá' },
  { code: 'PT', nome: 'Portugal' },
  { code: 'ES', nome: 'Espanha' },
  { code: 'FR', nome: 'França' },
  { code: 'DE', nome: 'Alemanha' },
  { code: 'IT', nome: 'Itália' },
  { code: 'GB', nome: 'Reino Unido' },
  { code: 'NL', nome: 'Países Baixos' },
  { code: 'CH', nome: 'Suíça' },
  { code: 'JP', nome: 'Japão' },
  { code: 'CN', nome: 'China' },
  { code: 'KR', nome: 'Coreia do Sul' },
  { code: 'IN', nome: 'Índia' },
  { code: 'AU', nome: 'Austrália' },
  { code: 'NZ', nome: 'Nova Zelândia' },
  { code: 'ZA', nome: 'África do Sul' },
] as const;

export interface MunicipioIBGE {
  id: number;
  nome: string;
}

const IBGE_ENDPOINT =
  'https://servicodados.ibge.gov.br/api/v1/localidades/estados';

export async function fetchCidades(
  uf: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MunicipioIBGE[]> {
  if (!/^[A-Z]{2}$/.test(uf)) return [];
  const res = await fetchImpl(`${IBGE_ENDPOINT}/${uf}/municipios`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const raw = (await res.json()) as Array<{ id: number; nome: string }>;
  return raw
    .map((m) => ({ id: m.id, nome: m.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Hook React. Carrega municípios da UF e mantém em cache perpétuo.
 * Retorna lista vazia enquanto `uf` for null/empty.
 */
export function useCidadesByUF(uf: string | null | undefined) {
  return useQuery<MunicipioIBGE[]>(
    ['ibge-cidades', uf ?? ''],
    () => fetchCidades(uf as string),
    {
      enabled: !!uf && /^[A-Z]{2}$/.test(uf),
      staleTime: Infinity,
      cacheTime: Infinity,
    },
  );
}
