/**
 * Default do slot {modal}. Quando a rota é só /pipeline (sem `[id]`),
 * o slot fica vazio — esse default evita "Page not found" no slot.
 */
export default function ModalDefault() {
  return null;
}
