import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';

import {
  OpportunityCard,
  type OpportunityCardData,
} from '@/components/crm/OpportunityCard';

/**
 * Sprint 15G Fase 4b — badge de unidade no OpportunityCard (crm/).
 *
 * A prop opcional `ownerUnitName` renderiza um Badge subtle no footer
 * pra dar contexto de "de qual equipe essa opp veio". Callers atuais
 * NÃO passam a prop (aguardando débito Sprint 15H no backend
 * `opportunities.list` incluir `owner.primaryUnit.name`).
 */

function makeCard(overrides: Partial<OpportunityCardData> = {}): OpportunityCardData {
  return {
    id: 'opp-1',
    companyName: 'ACME LTDA',
    stage: { label: 'Lead', variant: 'primary' },
    valueBrl: 12500,
    ownerName: 'Alice',
    ...overrides,
  };
}

describe('<OpportunityCard /> ownerUnitName badge (Sprint 15G Fase 4b)', () => {
  it('sem prop ownerUnitName, badge não renderiza', () => {
    render(<OpportunityCard card={makeCard()} />);
    expect(screen.queryByTestId('opp-card-owner-unit')).toBeNull();
  });

  it('com prop ownerUnitName, badge renderiza com texto e title acessível', () => {
    render(
      <OpportunityCard
        card={makeCard({ ownerUnitName: 'Equipe São Paulo' })}
      />,
    );

    const badge = screen.getByTestId('opp-card-owner-unit');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Equipe São Paulo');
    expect(badge).toHaveAttribute('title', 'Unidade: Equipe São Paulo');
    expect(badge).toHaveAttribute('aria-label', 'Unidade: Equipe São Paulo');
  });

  it('nome longo aplica truncate via max-w-[120px]', () => {
    render(
      <OpportunityCard
        card={makeCard({
          ownerUnitName: 'Unidade Regional Sudeste — Divisão Grande Contas Norte-Sul',
        })}
      />,
    );

    const badge = screen.getByTestId('opp-card-owner-unit');
    expect(badge.className).toMatch(/truncate/);
    expect(badge.className).toMatch(/max-w-\[120px\]/);
    // Texto integral fica no DOM (para tooltip / screen reader) mesmo
    // que truncado visualmente.
    expect(badge).toHaveTextContent(
      /Unidade Regional Sudeste — Divisão Grande Contas Norte-Sul/,
    );
  });

  it('ownerUnitName null/undefined ambos escondem o badge (nenhum falso positivo)', () => {
    const { rerender } = render(
      <OpportunityCard card={makeCard({ ownerUnitName: null })} />,
    );
    expect(screen.queryByTestId('opp-card-owner-unit')).toBeNull();

    rerender(<OpportunityCard card={makeCard({ ownerUnitName: undefined })} />);
    expect(screen.queryByTestId('opp-card-owner-unit')).toBeNull();
  });
});
