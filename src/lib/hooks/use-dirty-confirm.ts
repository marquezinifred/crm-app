'use client';

import { useCallback, useState } from 'react';

/**
 * Sprint 15C — Form UX hardening.
 *
 * Hook que confirma com o usuário antes de fechar/cancelar um form com
 * estado modificado. Combina com `<AlertDialog>` no consumidor:
 *
 *   const dirty = isDirtyFlag(...)              // do form state
 *   const { confirmingClose, requestClose, confirm, cancel } =
 *     useDirtyConfirm(dirty, onClose)
 *
 *   <Button onClick={requestClose}>Cancelar</Button>
 *   <AlertDialog
 *     open={confirmingClose}
 *     onCancel={cancel}
 *     onConfirm={confirm}
 *     title="Há alterações não salvas."
 *     description="Deseja sair mesmo assim?"
 *     confirmLabel="Sair sem salvar"
 *     cancelLabel="Continuar editando"
 *   />
 */
export function useDirtyConfirm(isDirty: boolean, onClose: () => void) {
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = useCallback(() => {
    if (isDirty) setConfirmingClose(true);
    else onClose();
  }, [isDirty, onClose]);

  const confirm = useCallback(() => {
    setConfirmingClose(false);
    onClose();
  }, [onClose]);

  const cancel = useCallback(() => setConfirmingClose(false), []);

  return { confirmingClose, requestClose, confirm, cancel };
}
