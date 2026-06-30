import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-page">
      <div className="w-full max-w-md">
        <header className="text-center mb-6">
          <div className="text-[28px] font-black text-brand-primary-light tracking-tight">
            VENZO
          </div>
          <p className="text-caption text-text-3 mt-1">
            Crie sua conta e feche mais.
          </p>
        </header>
        <SignUp appearance={{ elements: { card: 'shadow-2xl border border-border' } }} />
      </div>
    </div>
  );
}
