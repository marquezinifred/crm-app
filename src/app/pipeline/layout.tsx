/**
 * Layout do segmento /pipeline — Sprint 14 (P1).
 *
 * O slot `{modal}` permite renderizar o DetailSheet via intercepting
 * route (`@modal/(.)[id]/page.tsx`). Quando o usuário clica num card
 * do Kanban, Next.js intercepta a navegação para `/pipeline/[id]` e
 * renderiza o slot modal sobre o kanban — URL é atualizada
 * (`/pipeline/{id}`), botão Voltar fecha o sheet.
 *
 * Acesso direto via deep link (`/pipeline/{id}` em nova aba ou F5)
 * renderiza `app/pipeline/[id]/page.tsx` (full-page).
 */
export default function PipelineLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
