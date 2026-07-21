import { prisma } from '@/server/db/client';
import { SalesUnitRepository } from '@/server/db/repositories/sales-unit.repository';

/**
 * Sprint 15G.5 Fase 1b — Camada de autoridade estrutural do workflow de
 * transferência de oportunidade (P-87). Define QUEM pode disparar, sobre QUAIS
 * opps, para QUAIS destinos, e QUEM pode virar novo owner.
 *
 * ⚠️ CONVENÇÃO T13 — AUTORIDADE 100% ESTRUTURAL:
 *   A autoridade deriva SEMPRE da estrutura de vendas: `sales_unit_members.role`
 *   (MANAGER/MEMBER — papel NA UNIDADE) + posição ltree (`sales_units.parent_id`
 *   / `path`). **NUNCA** de `users.role` (perfil global). Um novo cargo nomeado
 *   (Coordenador, Head) não pode quebrar esta lógica — por isso nenhuma função
 *   aqui indexa por `users.role`. O gate `opportunity:transfer` (T12, chip 2a) é
 *   apenas o *interruptor de capacidade*; a autoridade real é o check estrutural
 *   destas funções, avaliado **por-opp**.
 *
 * Composição estrutural:
 *   - **sources** = subárvore gerida pelo caller (`getSubtreeMemberIds` — união
 *     nativa de todas as unidades onde ele é MANAGER; multi-membership de graça).
 *     O caller é ancestor MANAGER desses membros → pode disparar sobre as opps
 *     deles (menos as próprias).
 *   - **targets** = pares imediatos (unidades-irmãs) + superior direto
 *     (unidade-pai), unidos por membership (`SalesUnitRepository.resolveTransferTargets`).
 *
 * Funções assíncronas puras — testáveis sem tRPC com repo + prisma mockados
 * (padrão `sales-structure.service.test.ts`). O router (chip 2a) gateia com
 * `withPermission('opportunity:transfer')` e chama estes checks por cima.
 */
export const TransferScopeService = {
  /**
   * IDs cujas opps o `callerId` pode disparar transferência: a subárvore que ele
   * gerencia como MANAGER (T13). Reusa direto o helper do 15G — `getSubtreeMemberIds`
   * já une todas as unidades onde o caller é MANAGER (multi-membership resolvido
   * pela união nativa do `<@ ANY`). Retorna Set pra lookup O(1) em `canTransferOpportunity`.
   *
   * O próprio caller vem incluído no conjunto (ele é membro das unidades que
   * gerencia); `canTransferOpportunity` exclui a opp própria antes de consultar.
   */
  async resolveTransferSources(
    callerId: string,
    tenantId: string,
  ): Promise<Set<string>> {
    const ids = await SalesUnitRepository.getSubtreeMemberIds(callerId, tenantId);
    return new Set(ids);
  },

  /**
   * Avaliado **por-opp** (T13). O caller pode disparar transferência de uma opp
   * quando é ancestor MANAGER do dono atual dela — nunca o próprio dono. Regras
   * cardinais §2.1 (dono não dispara sobre a própria; ancestor dispara sobre
   * subordinado).
   *
   * Retorna `false` quando: a opp não existe no tenant (ou está soft-deleted);
   * a opp não tem owner (lead inbound não alocado — nada a transferir); o caller
   * É o dono; ou o dono não está na subárvore gerida pelo caller.
   */
  async canTransferOpportunity(
    callerId: string,
    opportunityId: string,
    tenantId: string,
  ): Promise<boolean> {
    const opp = await prisma.opportunity.findFirst({
      where: { id: opportunityId, tenantId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!opp || !opp.ownerId) return false;
    if (opp.ownerId === callerId) return false;

    const sources = await TransferScopeService.resolveTransferSources(
      callerId,
      tenantId,
    );
    return sources.has(opp.ownerId);
  },

  /**
   * Managers-alvo válidos do disparo (T14): pares imediatos (unidades-irmãs) +
   * superior direto (unidade-pai), unidos por membership. Wrapper fino sobre o
   * `$queryRaw` estrutural do repositório — a lógica ltree vive lá.
   */
  async resolveTransferTargets(
    callerId: string,
    tenantId: string,
  ): Promise<string[]> {
    return SalesUnitRepository.resolveTransferTargets(callerId, tenantId);
  },

  /**
   * O destinatário (`targetManagerId`) só pode atribuir a opp recebida a alguém
   * da PRÓPRIA subárvore (T10 — anti-escalada no approve, chip 2a). `newOwnerId`
   * precisa estar em `getSubtreeMemberIds(targetManagerId)`.
   */
  async canReceiveAsNewOwner(
    targetManagerId: string,
    newOwnerId: string,
    tenantId: string,
  ): Promise<boolean> {
    const subtree = await SalesUnitRepository.getSubtreeMemberIds(
      targetManagerId,
      tenantId,
    );
    return subtree.includes(newOwnerId);
  },

  /**
   * Valida o destino do disparo (usado pelo `request` — chip 2a): o
   * `targetManagerId` precisa ser um par imediato ou superior direto do caller
   * (∈ `resolveTransferTargets`). Fecha a regra §2.2 (nunca subordinado, nunca
   * ADMIN fora da estrutura).
   */
  async isValidTransferTarget(
    callerId: string,
    targetManagerId: string,
    tenantId: string,
  ): Promise<boolean> {
    const targets = await TransferScopeService.resolveTransferTargets(
      callerId,
      tenantId,
    );
    return targets.includes(targetManagerId);
  },
};
