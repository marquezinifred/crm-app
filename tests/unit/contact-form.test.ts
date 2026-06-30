import { describe, it, expect } from 'vitest';
import { contactCreateInput, contactUpdateInput } from '@/lib/validators/contact';

const BASE = {
  fullName: 'Maria Silva Santos',
  email: 'maria@example.com',
  relationshipType: 'CLIENTE' as const,
};

describe('contactCreateInput', () => {
  it('aceita payload mínimo', () => {
    const r = contactCreateInput.safeParse(BASE);
    expect(r.success).toBe(true);
  });

  it('email inválido falha', () => {
    const r = contactCreateInput.safeParse({ ...BASE, email: 'sem-arroba' });
    expect(r.success).toBe(false);
  });

  it('fullName curto demais falha', () => {
    const r = contactCreateInput.safeParse({ ...BASE, fullName: 'M' });
    expect(r.success).toBe(false);
  });

  it('relationshipType default CLIENTE', () => {
    const { relationshipType: _ignored, ...rest } = BASE;
    void _ignored;
    const r = contactCreateInput.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.relationshipType).toBe('CLIENTE');
  });

  it('workArea enum válido', () => {
    const r = contactCreateInput.safeParse({ ...BASE, workArea: 'COMERCIAL' });
    expect(r.success).toBe(true);
  });

  it('workArea enum inválido falha', () => {
    const r = contactCreateInput.safeParse({ ...BASE, workArea: 'INVALID' as never });
    expect(r.success).toBe(false);
  });
});

describe('contactUpdateInput', () => {
  it('patch parcial com id', () => {
    const r = contactUpdateInput.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      position: 'Diretora',
    });
    expect(r.success).toBe(true);
  });
});
