import { randomBytes } from 'crypto';

// Sprint 15G Fase 1a — identificador curto usado como label de um nó ltree
// em `sales_units.short_id`. 8 caracteres alfanuméricos [a-z0-9]. Bate com
// a regex do CHECK constraint `sales_units_path_not_empty` (Emenda A7):
//   `path::text ~ '^[a-zA-Z0-9._]+$'`
//
// Colisão: com 8 chars sobre alfabeto de 36 símbolos, o espaço é ~2.8×10¹²
// combinações. Pra 1000 unidades por tenant, probabilidade de colisão é
// desprezível; ainda assim o CONSTRAINT `sales_units_tenant_short_id_unique`
// bloqueia colisão em runtime (repository deve tratar UniqueViolation
// tentando novo short_id — não implementado nesta Fase 1a; unidades são
// criadas em bulk apenas via backfill da migration).
//
// randomBytes é criptográfico; suficiente pra não-adivinhabilidade. Não
// determinístico por design — testes que precisam determinismo devem
// injetar via mock ou passar short_id pré-gerado no input do repository.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateShortId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}
