// P-47 — carrega .env com precedence antes do Vitest importar src/lib/env.ts.
// Sem este setup, tests dependiam de `source .env.local` manual no shell
// (baseline oscilava 693 → 741 conforme o dev lembrasse). Precedence
// espelha Next.js: .env.test bate .env.local bate .env. `override: false`
// preserva vars já setadas no ambiente (CI injeta direto, source manual etc).
import { config } from 'dotenv';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

config({ path: path.join(ROOT, '.env.test'), override: false });
config({ path: path.join(ROOT, '.env.local'), override: false });
config({ path: path.join(ROOT, '.env'), override: false });
