import { describe, it, expect } from 'vitest';
import {
  renderRelationshipAlert,
  renderPipelineAlert,
} from '@/lib/email/templates';

describe('renderRelationshipAlert', () => {
  it('inclui "Hoje" quando leadDays=0', () => {
    const r = renderRelationshipAlert({
      entityName: 'Acme Tech',
      entityType: 'COMPANY',
      dateType: 'FUNDACAO',
      dateLabel: 'Aniversário da empresa',
      scheduledFor: new Date(2026, 5, 27),
      leadDays: 0,
      appUrl: 'https://crm.local',
      entityUrl: 'https://crm.local/companies/abc',
    });
    expect(r.subject).toContain('Hoje');
    expect(r.subject).toContain('Acme Tech');
    expect(r.html).toContain('Acme Tech');
  });

  it('inclui "Em N dias" quando leadDays > 0', () => {
    const r = renderRelationshipAlert({
      entityName: 'Maria',
      entityType: 'CONTACT',
      dateType: 'ANIVERSARIO',
      scheduledFor: new Date(2026, 5, 30),
      leadDays: 7,
      appUrl: 'https://x',
      entityUrl: 'https://x/contacts/1',
    });
    expect(r.subject).toMatch(/Em 7 dia/);
  });
});

describe('renderPipelineAlert', () => {
  it('formata título e link', () => {
    const r = renderPipelineAlert({
      opportunityTitle: 'Implementação CRM',
      stage: 'OPORTUNIDADE',
      marker: 'Fechamento previsto',
      scheduledFor: new Date(2026, 6, 4),
      leadDays: 7,
      opportunityUrl: 'https://x/pipeline/1',
      appUrl: 'https://x',
    });
    expect(r.subject).toContain('Implementação CRM');
    expect(r.subject).toContain('Fechamento previsto');
    expect(r.html).toContain('https://x/pipeline/1');
  });
});
