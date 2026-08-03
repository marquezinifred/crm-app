'use client';

import { useState } from 'react';
import { useClerk } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

/**
 * P-82 — Tela exibida quando a sessão Clerk é válida mas não existe row
 * correspondente em `users` (conta autenticada porém não provisionada
 * neste workspace — ex.: pós restore Neon PITR, ver
 * `docs/Runbook_Recovery_Pos_Neon_Restore.md`).
 *
 * O `sessionAwareFetch` (src/lib/trpc/session-guard.ts) redireciona pra cá
 * ao detectar o marcador `USER_NOT_PROVISIONED` num 401 — em vez de
 * recarregar em loop. Esta página NÃO faz nenhuma chamada tRPC autenticada
 * (ela existe justamente porque o tRPC devolve 401), então não precisa de
 * user provisionado pra renderizar.
 */
export default function AccountNotFoundPage() {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    setSigningOut(true);
    // redirectUrl leva pro login pra trocar de conta.
    void signOut({ redirectUrl: '/sign-in' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-page">
      <div className="w-full max-w-md">
        <header className="text-center mb-6">
          <div className="text-[28px] font-black text-brand-primary-light tracking-tight">
            VENZO
          </div>
          <p className="text-caption text-text-3 mt-1">CRM B2B</p>
        </header>

        <div className="rounded-lg border border-border bg-card p-6 shadow-2xl text-center">
          <h1 className="text-lg font-semibold text-text-1">
            Conta sem acesso a este workspace
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-2">
            Você está autenticado, mas esta conta ainda não está provisionada
            neste workspace. Isso pode acontecer logo após uma manutenção de
            dados. Se você acabou de entrar, tente sair e acessar com a conta
            correta — ou fale com o administrador do workspace.
          </p>

          <div className="mt-6">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handleSignOut}
              loading={signingOut}
            >
              Sair
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
