'use client';

import * as React from 'react';
import { Modal, ModalFooter } from './modal';
import { Button } from './button';

/**
 * AlertDialog — confirmação destrutiva ou de "perde alterações".
 *
 * Wrapper enxuto sobre o `Modal` Venzo. NÃO usa `confirm()` nativo
 * (proibido pelo design system; quebra com focus trap e tokens).
 *
 * Sprint 15C — usado pelo `useDirtyConfirm` quando o usuário tenta
 * fechar um form com alterações não salvas, e por confirmações de
 * exclusão em /admin/listas.
 */
export function AlertDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  loading,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} description={description} size="sm">
      <ModalFooter>
        <Button variant="ghost" type="button" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          type="button"
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
