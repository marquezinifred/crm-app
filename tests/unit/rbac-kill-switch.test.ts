// @vitest-environment node
//
// P-62 — Kill-switch runtime real do RBAC granular.
// `env.RBAC_GRANULAR_ENABLED=false` → `hasPermission` volta ao role default
// puro (sem overrides, sem cache). `true` (default P-62) preserva Sprint 15E
// completo. Rollback é reversível — só religar a flag.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUser, mockEnv } = vi.hoisted(() => ({
  mockUser: {
    findUnique: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  // P-62 — mockar env pra alternar a flag entre testes sem re-importar módulos.
  mockEnv: { RBAC_GRANULAR_ENABLED: true },
}));

vi.mock('@/server/db/client', () => ({
  prisma: { user: mockUser },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
}));

vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { hasPermission } from '@/server/services/permissions.service';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.RBAC_GRANULAR_ENABLED = true;
});

describe('P-62 — kill-switch RBAC_GRANULAR_ENABLED', () => {
  describe('flag=true (default): path granular Sprint 15E', () => {
    it('cache hit: usa cachedPermissions in-memory (respeita override granted)', async () => {
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        cachedPermissions: ['opportunity:read', 'inbound:view_queue'],
        cachedPermissionsAt: new Date('2026-07-05T12:00:00Z'),
        deletedAt: null,
        active: true,
      });

      // ANALISTA não tem `inbound:view_queue` no default — mas override
      // granted foi cacheado. Path granular deve retornar true.
      const ok = await hasPermission('user-1', 'inbound:view_queue');

      expect(ok).toBe(true);
      expect(mockUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.objectContaining({
          cachedPermissions: true,
          cachedPermissionsAt: true,
        }),
      });
    });

    it('cache hit: respeita override revoked (permission fora do array)', async () => {
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: null,
        // ADMIN teria `user:delete` default; overrides revoked → não aparece.
        cachedPermissions: ['opportunity:read', 'company:read'],
        cachedPermissionsAt: new Date('2026-07-05T12:00:00Z'),
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('user-1', 'user:delete');

      expect(ok).toBe(false);
    });

    it('Platform Owner bypass total (não olha cache)', async () => {
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: 'PLATFORM_OWNER',
        cachedPermissions: [],
        cachedPermissionsAt: null,
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('platform-1', 'user:delete');

      expect(ok).toBe(true);
    });

    it('deletedAt/inactive → false mesmo com cache válido', async () => {
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: null,
        cachedPermissions: ['user:delete'],
        cachedPermissionsAt: new Date(),
        deletedAt: new Date('2026-07-01'),
        active: true,
      });

      const ok = await hasPermission('user-1', 'user:delete');

      expect(ok).toBe(false);
    });
  });

  describe('flag=false: rollback ao role default puro', () => {
    it('ADMIN mantém acesso via ROLE_DEFAULT_PERMISSIONS (60 permissions)', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: null,
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('user-1', 'opportunity:update');

      expect(ok).toBe(true);
      // Query enxuta — sem cachedPermissions no select
      expect(mockUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          role: true,
          platformRole: true,
          deletedAt: true,
          active: true,
        },
      });
    });

    it('ANALISTA com override granted PERDE acesso — kill-switch ignora overrides', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      // Cenário crítico do rollback: analista tinha `inbound:view_queue`
      // via grant individual do admin. Com flag=false, override é ignorado
      // e cai no default puro — ANALISTA não tem essa permission por default.
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('user-1', 'inbound:view_queue');

      expect(ok).toBe(false);
    });

    it('ANALISTA mantém `opportunity:read` (é default do role)', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('user-1', 'opportunity:read');

      expect(ok).toBe(true);
    });

    it('ANALISTA não tem `opportunity:read_team` (Sprint 15G Fase 1b: substituiu read_others como breaking change preservado)', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('user-1', 'opportunity:read_team');

      expect(ok).toBe(false);
    });

    it('Platform Owner bypass funciona também com flag=false', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: 'PLATFORM_OWNER',
        deletedAt: null,
        active: true,
      });

      // audit:read_platform não está em nenhum role default — só Platform Owner
      const ok = await hasPermission('platform-1', 'audit:read_platform');

      expect(ok).toBe(true);
    });

    it('deletedAt → false (respeitado no path legado também)', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: null,
        deletedAt: new Date('2026-07-01'),
        active: true,
      });

      const ok = await hasPermission('user-1', 'opportunity:update');

      expect(ok).toBe(false);
    });

    it('active=false → false', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
        platformRole: null,
        deletedAt: null,
        active: false,
      });

      const ok = await hasPermission('user-1', 'opportunity:update');

      expect(ok).toBe(false);
    });

    it('user não encontrado → false', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce(null);

      const ok = await hasPermission('user-missing', 'opportunity:read');

      expect(ok).toBe(false);
    });

    it('PARCEIRO com apenas 5 permissions default (sem overrides)', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'PARCEIRO',
        platformRole: null,
        deletedAt: null,
        active: true,
      });

      const canRead = await hasPermission('user-1', 'company:read');
      expect(canRead).toBe(true);
    });

    it('PARCEIRO sem `opportunity:update` (não está no default)', async () => {
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'PARCEIRO',
        platformRole: null,
        deletedAt: null,
        active: true,
      });

      const ok = await hasPermission('user-1', 'opportunity:update');
      expect(ok).toBe(false);
    });
  });

  describe('rollback reversível (flip mid-runtime)', () => {
    it('flag=true→false→true no mesmo user preserva default; override volta a valer quando religa', async () => {
      // Round 1: flag ON, cache com override granted
      mockEnv.RBAC_GRANULAR_ENABLED = true;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        cachedPermissions: ['opportunity:read', 'inbound:view_queue'],
        cachedPermissionsAt: new Date(),
        deletedAt: null,
        active: true,
      });
      expect(await hasPermission('user-1', 'inbound:view_queue')).toBe(true);

      // Round 2: flag OFF — mesmo user, mesma DB row (cache preservado no DB
      // mas ignorado runtime). Query nova, sem cachedPermissions no select.
      mockEnv.RBAC_GRANULAR_ENABLED = false;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        deletedAt: null,
        active: true,
      });
      expect(await hasPermission('user-1', 'inbound:view_queue')).toBe(false);

      // Round 3: flag ON de novo, cache DB ainda íntegro — override volta.
      mockEnv.RBAC_GRANULAR_ENABLED = true;
      mockUser.findUnique.mockResolvedValueOnce({
        role: 'ANALISTA',
        platformRole: null,
        cachedPermissions: ['opportunity:read', 'inbound:view_queue'],
        cachedPermissionsAt: new Date(),
        deletedAt: null,
        active: true,
      });
      expect(await hasPermission('user-1', 'inbound:view_queue')).toBe(true);
    });
  });
});
