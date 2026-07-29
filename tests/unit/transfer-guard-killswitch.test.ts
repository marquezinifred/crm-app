// @vitest-environment node

/**
 * R2 (Sprint 15G.5) — kill-switch do guard de transferência EXECUTÁVEL.
 *
 * `isTransferGuardEnabled()` (src/server/db/client.ts) é uma função pura que
 * lê `process.env.OPPORTUNITY_TRANSFER_ENABLED` em RUNTIME e faz parse LITERAL
 * — a MESMA semântica de `envBoolean` (P-60): só "true|1|yes|on" (trimmed,
 * case-insensitive) ligam; ausente/vazio/qualquer-outro → false.
 *
 * Esta é a rede que garante "flag OFF → guard inerte → merge/deploy não muda
 * comportamento em prod". O QA Modo A verificou só por leitura; aqui vira
 * teste (não precisa de DB — lê process.env direto).
 *
 * O parse REAL da função aceita como `true` EXATAMENTE: 'true' | '1' | 'yes'
 * | 'on' (após trim + toLowerCase). Todo o resto — incluindo `undefined` e
 * string vazia — é `false`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTransferGuardEnabled } from '@/server/db/client';

const KEY = 'OPPORTUNITY_TRANSFER_ENABLED';

describe('isTransferGuardEnabled — kill-switch runtime (R2)', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
  });

  afterEach(() => {
    // Restaura o valor original pra não vazar estado entre testes.
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  describe('valores que LIGAM o guard (→ true)', () => {
    it.each(['true', '1', 'yes', 'on', 'TRUE', 'On'])(
      '"%s" → true',
      (value) => {
        process.env[KEY] = value;
        expect(isTransferGuardEnabled()).toBe(true);
      },
    );

    it('ignora espaços ao redor (trim)', () => {
      process.env[KEY] = '  true ';
      expect(isTransferGuardEnabled()).toBe(true);
    });
  });

  describe('valores que MANTÊM o guard inerte (→ false)', () => {
    // O caso mais importante — o bug P-60: `Boolean("false") === true` LIGARIA
    // silenciosamente o guard. O parse literal garante que "false" → false.
    it('"false" → false (NÃO true — regressão do bug P-60)', () => {
      process.env[KEY] = 'false';
      expect(isTransferGuardEnabled()).toBe(false);
    });

    it.each(['0', 'no', 'off', ''])('"%s" → false', (value) => {
      process.env[KEY] = value;
      expect(isTransferGuardEnabled()).toBe(false);
    });

    it('undefined (var ausente) → false (default flag OFF)', () => {
      delete process.env[KEY];
      expect(isTransferGuardEnabled()).toBe(false);
    });

    it('valor desconhecido ("garbage") → false (não liga silenciosamente)', () => {
      process.env[KEY] = 'garbage';
      expect(isTransferGuardEnabled()).toBe(false);
    });
  });
});
