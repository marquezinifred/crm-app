import { describe, it, expect } from 'vitest';
import {
  renderTransferRequestedToManager,
  renderTransferRequestedToOwner,
  renderTransferApprovedToNewOwner,
  renderTransferApproved,
  renderTransferRejected,
  renderTransferCancelled,
  renderTransferTimedOut,
  transferRequestedToManagerPush,
  transferRequestedToOwnerPush,
  transferApprovedToNewOwnerPush,
  transferApprovedPush,
  transferRejectedPush,
  transferCancelledPush,
  transferTimedOutPush,
  type TransferNotificationVars,
  type TransferPushPayload,
} from '@/lib/email/templates';

/**
 * Sprint 15G.5 chip 2b — os 7 templates de notificação de transferência.
 * Cada evento tem um render de e-mail (subject + html) e um builder de push
 * (title + body + url). Cobre: campos certos no corpo, e — crítico — push
 * SEM PII sensível (email / texto livre de justificativa).
 */

const baseVars: TransferNotificationVars = {
  recipientName: 'Ana',
  opportunityTitle: 'Implantação ERP',
  companyName: 'ACME LTDA',
  requesterName: 'Bruno Gestor',
  targetManagerName: 'Carla Diretora',
  newOwnerName: 'Diego Vendedor',
  reason: 'Cliente mudou de região para o RJ',
  decisionReason: 'Faz mais sentido na equipe RJ',
  opportunityUrl: 'https://crm.venzo.app/pipeline/opp-1',
  inboxUrl: 'https://crm.venzo.app/inbox/transferencias-recebidas',
};

// PII sensível que NUNCA deve aparecer em push (email/telefone/doc).
const SENSITIVE = ['bruno@acme.com', '@', '11987654321', '12.345.678/0001-90'];

function assertNoSensitivePush(p: TransferPushPayload) {
  const blob = `${p.title} ${p.body}`;
  for (const s of SENSITIVE) {
    expect(blob).not.toContain(s);
  }
  // Texto livre de justificativa também não vaza pro push.
  expect(blob).not.toContain('Cliente mudou de região');
  expect(blob).not.toContain('Faz mais sentido');
}

describe('templates de transferência — e-mail (7)', () => {
  it('1/7 REQUESTED → destinatário: ação de análise + motivo + CTA fila', () => {
    const r = renderTransferRequestedToManager(baseVars);
    expect(r.subject).toContain('análise');
    expect(r.subject).toContain('Implantação ERP');
    expect(r.html).toContain('ACME LTDA');
    expect(r.html).toContain('Bruno Gestor');
    expect(r.html).toContain('Cliente mudou de região para o RJ'); // reason no e-mail
    expect(r.html).toContain(baseVars.inboxUrl!); // CTA aponta pra fila
    expect(r.html).toContain('Ver solicitação');
  });

  it('2/7 REQUESTED → dono original: aviso de somente-leitura', () => {
    const r = renderTransferRequestedToOwner(baseVars);
    expect(r.subject).toContain('em transferência');
    expect(r.html).toMatch(/somente leitura/i);
    expect(r.html).toContain('Implantação ERP');
    expect(r.html).toContain(baseVars.opportunityUrl);
  });

  it('3/7 APPROVED → novo owner: você recebeu a oportunidade', () => {
    const r = renderTransferApprovedToNewOwner(baseVars);
    expect(r.subject).toContain('Você recebeu');
    expect(r.html).toContain('Carla Diretora'); // quem atribuiu
    expect(r.html).toContain('Implantação ERP');
    expect(r.html).toContain('Abrir oportunidade');
  });

  it('4/7 APPROVED → disparador + dono: aprovada + novo responsável + observação', () => {
    const r = renderTransferApproved(baseVars);
    expect(r.subject).toContain('aprovada');
    expect(r.html).toContain('Carla Diretora');
    expect(r.html).toContain('Diego Vendedor'); // novo responsável
    expect(r.html).toContain('Faz mais sentido na equipe RJ'); // decisionReason no e-mail
  });

  it('5/7 REJECTED → disparador + dono: recusada + motivo da recusa', () => {
    const r = renderTransferRejected(baseVars);
    expect(r.subject).toContain('recusada');
    expect(r.html).toContain('Carla Diretora');
    expect(r.html).toContain('Faz mais sentido na equipe RJ');
    expect(r.html).toMatch(/permanece/i);
  });

  it('6/7 CANCELLED → dono + destinatário: cancelada pelo disparador', () => {
    const r = renderTransferCancelled(baseVars);
    expect(r.subject).toContain('cancelada');
    expect(r.html).toContain('Bruno Gestor');
    expect(r.html).toContain('Implantação ERP');
  });

  it('7/7 TIMED_OUT → disparador + dono: expirou sem decisão', () => {
    const r = renderTransferTimedOut(baseVars);
    expect(r.subject).toContain('expirada');
    expect(r.html).toMatch(/expirou/i);
    expect(r.html).toMatch(/permanece/i);
    expect(r.html).toContain('Implantação ERP');
  });

  it('usa apenas o título quando não há empresa; saudação genérica sem recipientName', () => {
    const r = renderTransferTimedOut({
      opportunityTitle: 'Deal sem empresa',
      opportunityUrl: 'https://x/pipeline/1',
    });
    expect(r.subject).toContain('Deal sem empresa');
    expect(r.subject).not.toContain('(');
    expect(r.html).toContain('Olá,'); // sem nome → saudação genérica
  });
});

describe('templates de transferência — push (7) sem PII sensível', () => {
  const cases: Array<[string, TransferPushPayload]> = [
    ['requestedToManager', transferRequestedToManagerPush(baseVars)],
    ['requestedToOwner', transferRequestedToOwnerPush(baseVars)],
    ['approvedToNewOwner', transferApprovedToNewOwnerPush(baseVars)],
    ['approved', transferApprovedPush(baseVars)],
    ['rejected', transferRejectedPush(baseVars)],
    ['cancelled', transferCancelledPush(baseVars)],
    ['timedOut', transferTimedOutPush(baseVars)],
  ];

  it.each(cases)('push %s tem title/body/url e sem PII sensível', (_name, payload) => {
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.body).toContain('Implantação ERP'); // info comercial OK
    expect(payload.url).toMatch(/^https?:\/\//);
    assertNoSensitivePush(payload);
  });

  it('push do destinatário aponta pra fila; os demais pra opp', () => {
    expect(transferRequestedToManagerPush(baseVars).url).toBe(baseVars.inboxUrl);
    expect(transferApprovedToNewOwnerPush(baseVars).url).toBe(baseVars.opportunityUrl);
    expect(transferTimedOutPush(baseVars).url).toBe(baseVars.opportunityUrl);
  });

  it('push APPROVED inclui novo responsável (nome interno, não é PII sensível)', () => {
    const p = transferApprovedPush(baseVars);
    expect(p.body).toContain('Diego Vendedor');
  });

  it('empresa entra no corpo do push quando presente; título só quando ausente', () => {
    expect(transferTimedOutPush(baseVars).body).toContain('ACME LTDA');
    const noCompany = transferTimedOutPush({
      opportunityTitle: 'Solo',
      opportunityUrl: 'https://x/pipeline/1',
    });
    expect(noCompany.body).toBe('Solo');
  });
});
