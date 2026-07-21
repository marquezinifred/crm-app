/**
 * Catálogo estático de permissions granulares — Sprint 15E + 15G Fase 1b.
 *
 * Fonte da verdade: `docs/permission-matrix.md` + `docs/Sprint_15G_estrutura_comercial.md` §6.
 * Total: **65 permissions distintas** (Sprint 15G removeu `opportunity:read_others`
 * e adicionou `opportunity:read_team`, `opportunity:read_all`,
 * `sales_structure:read`, `sales_structure:manage` — 61 − 1 + 4 = 64; Sprint
 * 15G.5 adicionou `opportunity:transfer` (T12) → 65).
 *
 * Formato: `resource:action`. Alinhado com o legado `withCapability`
 * (Sprint 0). Novas features devem adicionar permission nova aqui
 * antes de criar/expandir role.
 */

export const PERMISSIONS_CATALOG = [
  // Tenant (2)
  { key: 'tenant:read', label: 'Ver dados do tenant', category: 'tenant' },
  { key: 'tenant:update', label: 'Editar dados do tenant', category: 'tenant' },

  // Users (5)
  { key: 'user:create', label: 'Convidar usuários', category: 'users' },
  { key: 'user:read', label: 'Ver usuários', category: 'users' },
  { key: 'user:update', label: 'Editar usuários (nome, role)', category: 'users' },
  { key: 'user:delete', label: 'Desativar usuários', category: 'users' },
  { key: 'user:grant_permissions', label: 'Conceder permissões individuais', category: 'users' },

  // Catalog — territories/segments/products/lead sources/industries/contact roles (4)
  { key: 'catalog:create', label: 'Criar itens do catálogo', category: 'catalog' },
  { key: 'catalog:read', label: 'Ver catálogo', category: 'catalog' },
  { key: 'catalog:update', label: 'Editar catálogo', category: 'catalog' },
  { key: 'catalog:delete', label: 'Remover itens do catálogo', category: 'catalog' },

  // Companies (4)
  { key: 'company:create', label: 'Cadastrar empresas', category: 'companies' },
  { key: 'company:read', label: 'Ver empresas', category: 'companies' },
  { key: 'company:update', label: 'Editar empresas', category: 'companies' },
  { key: 'company:delete', label: 'Desativar empresas', category: 'companies' },

  // Contacts (4)
  { key: 'contact:create', label: 'Cadastrar contatos', category: 'contacts' },
  { key: 'contact:read', label: 'Ver contatos', category: 'contacts' },
  { key: 'contact:update', label: 'Editar contatos', category: 'contacts' },
  { key: 'contact:delete', label: 'Desativar contatos', category: 'contacts' },

  // Opportunities (9) — Sprint 15G Fase 1b split visibilidade em team/all; 15G.5 add transfer (T12)
  { key: 'opportunity:create', label: 'Criar oportunidades', category: 'opportunities' },
  { key: 'opportunity:read', label: 'Ver oportunidades', category: 'opportunities' },
  { key: 'opportunity:update', label: 'Editar oportunidades', category: 'opportunities' },
  { key: 'opportunity:delete', label: 'Cancelar oportunidades', category: 'opportunities' },
  { key: 'opportunity:advance_stage', label: 'Avançar estágio no funil', category: 'opportunities' },
  { key: 'opportunity:cancel', label: 'Encerrar como perdida', category: 'opportunities' },
  { key: 'opportunity:read_team', label: 'Ver oportunidades da equipe gerenciada', category: 'opportunities' },
  { key: 'opportunity:read_all', label: 'Ver todas as oportunidades do tenant', category: 'opportunities' },
  { key: 'opportunity:transfer', label: 'Transferir responsabilidade de oportunidade', category: 'opportunities' },

  // Commercial — Sprint 15G Fase 1b estrutura organizacional (2)
  { key: 'sales_structure:read', label: 'Ver estrutura organizacional comercial', category: 'commercial' },
  { key: 'sales_structure:manage', label: 'Gerenciar estrutura e membros', category: 'commercial' },

  // Proposals (4)
  { key: 'proposal:create', label: 'Criar propostas', category: 'proposals' },
  { key: 'proposal:read', label: 'Ver propostas', category: 'proposals' },
  { key: 'proposal:update', label: 'Editar propostas', category: 'proposals' },
  { key: 'proposal:approve', label: 'Aprovar propostas', category: 'proposals' },

  // Contracts (3)
  { key: 'contract:create', label: 'Criar contratos', category: 'contracts' },
  { key: 'contract:read', label: 'Ver contratos', category: 'contracts' },
  { key: 'contract:update', label: 'Editar contratos', category: 'contracts' },

  // Documents — P-19 (3)
  { key: 'document:upload', label: 'Anexar documentos', category: 'documents' },
  { key: 'document:read', label: 'Ver documentos', category: 'documents' },
  { key: 'document:delete', label: 'Remover documentos', category: 'documents' },

  // Tasks — P-20 (3)
  { key: 'task:create', label: 'Criar tarefas', category: 'tasks' },
  { key: 'task:update', label: 'Editar tarefas', category: 'tasks' },
  { key: 'task:delete', label: 'Remover tarefas', category: 'tasks' },

  // Partners (2)
  { key: 'partner:invite', label: 'Convidar parceiros', category: 'partners' },
  { key: 'partner:approve_engagement', label: 'Aprovar engajamento de parceiros', category: 'partners' },

  // Inbound — Sprint 15D → 15E migra GESTOR_INBOUND pra estas 4 permissions (4)
  { key: 'inbound:view_queue', label: 'Ver fila de prospects inbound', category: 'inbound' },
  { key: 'inbound:assign_prospects', label: 'Alocar prospects inbound', category: 'inbound' },
  { key: 'inbound:configure', label: 'Configurar captura inbound (forms, sources)', category: 'inbound' },
  { key: 'inbound:view_reports', label: 'Ver relatório Inbound × Outbound', category: 'inbound' },

  // Reports (3)
  { key: 'reports:read', label: 'Ver relatórios', category: 'reports' },
  { key: 'reports:financial', label: 'Ver dados financeiros nos relatórios', category: 'reports' },
  { key: 'reports:export', label: 'Exportar relatórios em Excel', category: 'reports' },

  // AI — Sprint 15F split granular (7)
  { key: 'ai:use_summary', label: 'Usar resumo de comunicações (IA)', category: 'ai' },
  { key: 'ai:use_extraction', label: 'Usar extração de dados (IA)', category: 'ai' },
  { key: 'ai:use_scoring', label: 'Usar scoring de leads (IA)', category: 'ai' },
  { key: 'ai:configure_global', label: 'Configurar provider/modelo padrão', category: 'ai' },
  { key: 'ai:configure_feature', label: 'Configurar override por feature', category: 'ai' },
  { key: 'ai:test_key', label: 'Testar chave de provider', category: 'ai' },
  { key: 'ai:manage_breaker', label: 'Limpar circuit breaker', category: 'ai' },

  // Alerts (2)
  { key: 'alert:configure', label: 'Configurar alertas de renovação', category: 'alerts' },
  { key: 'alert:receive_admin', label: 'Receber alertas administrativos', category: 'alerts' },

  // Audit (2) — read_platform é Platform Owner only (bypass), listado pra clareza
  { key: 'audit:read', label: 'Ver logs de auditoria', category: 'audit' },
  { key: 'audit:read_platform', label: 'Ver logs cross-tenant (Platform)', category: 'audit' },

  // Import (2)
  { key: 'import:run', label: 'Rodar importações CSV/XLSX', category: 'import' },
  { key: 'import:read', label: 'Ver histórico de importações', category: 'import' },
] as const;

export type Permission = (typeof PERMISSIONS_CATALOG)[number]['key'];

export type PermissionCategory =
  | 'tenant'
  | 'users'
  | 'catalog'
  | 'companies'
  | 'contacts'
  | 'opportunities'
  | 'commercial'
  | 'proposals'
  | 'contracts'
  | 'documents'
  | 'tasks'
  | 'partners'
  | 'inbound'
  | 'reports'
  | 'ai'
  | 'alerts'
  | 'audit'
  | 'import';

/**
 * Set com todas as permission keys do catálogo — usado pra validar
 * strings vindas de input do usuário/db.
 */
export const PERMISSION_KEYS: ReadonlySet<Permission> = new Set(
  PERMISSIONS_CATALOG.map((p) => p.key),
);

export function isValidPermission(key: string): key is Permission {
  return PERMISSION_KEYS.has(key as Permission);
}

/**
 * Ordem de exibição das categorias na UI /admin/users/[id]/permissions.
 * Categorias de configuração ficam por último (menos usadas).
 */
export const CATEGORY_ORDER: readonly PermissionCategory[] = [
  'opportunities',
  'commercial',
  'proposals',
  'contracts',
  'documents',
  'tasks',
  'companies',
  'contacts',
  'inbound',
  'reports',
  'ai',
  'partners',
  'catalog',
  'users',
  'tenant',
  'import',
  'alerts',
  'audit',
];

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  tenant: 'Tenant',
  users: 'Usuários',
  catalog: 'Catálogo',
  companies: 'Empresas',
  contacts: 'Contatos',
  opportunities: 'Oportunidades',
  commercial: 'Estrutura comercial',
  proposals: 'Propostas',
  contracts: 'Contratos',
  documents: 'Documentos',
  tasks: 'Tarefas',
  partners: 'Parceiros',
  inbound: 'Inbound',
  reports: 'Relatórios',
  ai: 'IA',
  alerts: 'Alertas',
  audit: 'Auditoria',
  import: 'Importação',
};
