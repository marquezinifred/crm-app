import Link from 'next/link';
import { ContactDetailContent } from '@/components/contacts/ContactDetailContent';

export default function ContactFullPage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Trilha" className="mb-4 text-caption text-text-2">
        <Link href="/contacts" className="hover:text-text-1 underline">
          ← Voltar para contatos
        </Link>
      </nav>
      <ContactDetailContent contactId={params.id} />
    </div>
  );
}
