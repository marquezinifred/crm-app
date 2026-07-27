import { TransferStatus } from '@prisma/client';
import { Badge, type BadgeProps } from '@/components/ui/badge';

/**
 * Sprint 15G.5 Fase 3c — badge de status de transferência.
 *
 * Mapeia cada `TransferStatus` (fonte da verdade: enum Prisma) para
 * rótulo PT-BR + variante semântica do design system. Componente local
 * da tela /pipeline/transferencias-em-andamento.
 */
const STATUS_META: Record<
  TransferStatus,
  { label: string; variant: BadgeProps['variant'] }
> = {
  [TransferStatus.PENDING]: { label: 'Pendente', variant: 'warning' },
  [TransferStatus.APPROVED]: { label: 'Aprovada', variant: 'success' },
  [TransferStatus.REJECTED]: { label: 'Rejeitada', variant: 'danger' },
  [TransferStatus.CANCELLED]: { label: 'Cancelada', variant: 'default' },
  [TransferStatus.TIMED_OUT]: { label: 'Expirada', variant: 'info' },
};

/** Rótulo PT-BR de um status (reusado pelo filtro). */
export function transferStatusLabel(status: TransferStatus): string {
  return STATUS_META[status].label;
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** Ordem canônica dos status no dropdown de filtro. */
export const TRANSFER_STATUS_ORDER: TransferStatus[] = [
  TransferStatus.PENDING,
  TransferStatus.APPROVED,
  TransferStatus.REJECTED,
  TransferStatus.CANCELLED,
  TransferStatus.TIMED_OUT,
];
