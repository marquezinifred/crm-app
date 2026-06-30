/**
 * Layout de /companies — slot {modal} para intercepting route.
 *
 * Clique em uma linha → router.push('/companies/[id]') intercepta
 * em `@modal/(.)[id]/page.tsx` (Sheet sobre a lista). F5/deep link
 * cai em `[id]/page.tsx` full-page.
 */
export default function CompaniesLayout({
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
