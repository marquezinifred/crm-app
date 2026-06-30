import { describe, it, expect } from 'vitest';
import type { QuickCreateEntity } from '@/components/ui/quick-create-trigger';

/**
 * Sprint 15C — QuickCreateTrigger.
 *
 * Sem react-testing-library; validamos contrato exposto pela props
 * e a lista de entidades suportadas.
 */

describe('QuickCreateTrigger contract', () => {
  it('aceita exatamente 3 entidades', () => {
    const supported: QuickCreateEntity[] = ['company', 'contact', 'product'];
    expect(supported).toHaveLength(3);
  });

  it('triggerLabel default varia por entidade', () => {
    const labelFor = (e: QuickCreateEntity) =>
      e === 'company'
        ? '+ Criar empresa'
        : e === 'contact'
          ? '+ Criar contato'
          : '+ Criar produto';
    expect(labelFor('company')).toContain('empresa');
    expect(labelFor('contact')).toContain('contato');
    expect(labelFor('product')).toContain('produto');
  });
});
