'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Select } from '@/components/ui/input';

/**
 * Sprint 15G Fase 4b — Scope switcher do pipeline.
 *
 * Reflete o escopo resolvido pelo `SalesStructureService.resolveOpportunityScope`
 * (`trpc.salesStructure.myScope`) e deixa o caller filtrar entre "só as
 * minhas" e o escopo servidor (equipe ou tenant inteiro):
 *
 *   - scope.type = 'OWN' | 'PARTNER'  → nada a alternar. Componente
 *     não renderiza (retorna null) porque só há um escopo possível.
 *   - scope.type = 'TEAM'             → Select com 2 opções
 *     ("Minhas oportunidades" / "Minha equipe (N)").
 *   - scope.type = 'ALL'              → Select com 2 opções
 *     ("Minhas oportunidades" / "Toda a empresa").
 *   - scope.type = 'NONE' | undefined → não renderiza (usuário PARCEIRO
 *     sem vínculo, ou erro de rede — deixa a UI limpa).
 *
 * A escolha é entregue ao caller via `onChange(scope)` e persistida em
 * `localStorage` (chave `pipeline:scope-preference:{userId}`) pra
 * sobreviver refresh e navegação. O caller decide como traduzir o valor
 * escolhido em filtro tRPC (ex.: `ownerId: currentUser.id` quando `MINE`).
 *
 * Este chip NÃO estende o backend. O componente só reflete o escopo
 * servidor + filtra client-side.
 */

export type PipelineScopePreference = 'MINE' | 'TEAM' | 'ALL';

interface Props {
  /**
   * Callback disparado toda vez que o usuário troca de escopo.
   * O caller é responsável por traduzir em filtro (ex.: aplicar
   * `input.ownerId = currentUser.id` quando `MINE`).
   */
  onChange?: (scope: PipelineScopePreference) => void;
}

function storageKey(userId: string) {
  return `pipeline:scope-preference:${userId}`;
}

/**
 * Escolhe o default da preferência quando não há valor persistido em
 * localStorage. Regra §9.2: opção mais ampla disponível.
 */
function defaultPreference(scopeType: 'TEAM' | 'ALL'): PipelineScopePreference {
  return scopeType === 'ALL' ? 'ALL' : 'TEAM';
}

/**
 * Filtra preferências válidas pra evitar carregar valor stale que não
 * bate com o scope atual (ex.: user tinha ALL, admin rebaixou pra TEAM,
 * localStorage ainda tem 'ALL' — cai no default).
 */
function normalizePreference(
  stored: string | null,
  scopeType: 'TEAM' | 'ALL',
): PipelineScopePreference {
  if (stored === 'MINE') return 'MINE';
  if (stored === 'TEAM' && scopeType === 'TEAM') return 'TEAM';
  if (stored === 'ALL' && scopeType === 'ALL') return 'ALL';
  return defaultPreference(scopeType);
}

export function ScopeSwitcher({ onChange }: Props) {
  const scopeQ = trpc.salesStructure.myScope.useQuery(undefined, {
    staleTime: 60_000,
  });
  const meQ = trpc.users.me.useQuery(undefined, { staleTime: 60_000 });

  const scope = scopeQ.data;
  const userId = meQ.data?.id;
  const scopeType = scope?.type;
  const teamSize = scope && scope.type === 'TEAM' ? scope.teamSize : undefined;

  const canSwitch = scopeType === 'TEAM' || scopeType === 'ALL';

  const [preference, setPreference] = useState<PipelineScopePreference | null>(null);

  // Carrega preferência persistida do localStorage assim que `userId` +
  // `scopeType` estão disponíveis. Roda 1× por combinação — sem loop.
  useEffect(() => {
    if (!canSwitch || !userId || !scopeType) return;
    if (typeof window === 'undefined') return;
    if (scopeType !== 'TEAM' && scopeType !== 'ALL') return;
    const stored = window.localStorage.getItem(storageKey(userId));
    const initial = normalizePreference(stored, scopeType);
    setPreference(initial);
    onChange?.(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSwitch, userId, scopeType]);

  const options = useMemo(() => {
    if (scopeType === 'TEAM') {
      return [
        { value: 'MINE' as const, label: 'Minhas oportunidades' },
        {
          value: 'TEAM' as const,
          label:
            typeof teamSize === 'number'
              ? `Minha equipe (${teamSize})`
              : 'Minha equipe',
        },
      ];
    }
    if (scopeType === 'ALL') {
      return [
        { value: 'MINE' as const, label: 'Minhas oportunidades' },
        { value: 'ALL' as const, label: 'Toda a empresa' },
      ];
    }
    return [];
  }, [scopeType, teamSize]);

  if (!canSwitch || !userId || !preference) return null;

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="pipeline-scope-switcher"
        className="text-caption text-text-2 whitespace-nowrap"
      >
        Ver
      </label>
      <Select
        id="pipeline-scope-switcher"
        aria-label="Escopo de visualização das oportunidades"
        className="w-auto min-w-[200px]"
        value={preference}
        onChange={(e) => {
          const next = e.target.value as PipelineScopePreference;
          setPreference(next);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey(userId), next);
          }
          onChange?.(next);
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
