import { router, publicProcedure, protectedProcedure } from '@/server/trpc/trpc';
import { z } from 'zod';
import { onboardingRouter } from './onboarding';
import { territoriesRouter, segmentsRouter } from './catalog';
import { companiesRouter } from './companies';
import { contactsRouter } from './contacts';
import { productsRouter } from './products';
import { usersRouter } from './users';
import { opportunitiesRouter } from './opportunities';
import { partnerEngagementsRouter } from './partner-engagements';
import { contractsRouter } from './contracts';
import { alertsRouter } from './alerts';
import { activitiesRouter, tasksRouter } from './activities';
import { aiConfigRouter } from './ai-config';
import { reportsRouter } from './reports';
import { inboxRouter, searchRouter, adminEmailRouter } from './inbox';
import { partnersRouter } from './partners';
import { documentsRouter, templatesRouter } from './documents';
import { proposalsRouter, approvalsRouter } from './proposals';
import { approvalRulesRouter, contractsConfigRouter } from './approval-rules';
import { importsRouter } from './imports';
import { pushRouter } from './push';
import { themeRouter } from './theme';

export const appRouter = router({
  health: publicProcedure.query(() => ({
    status: 'ok' as const,
    ts: new Date().toISOString(),
  })),

  whoami: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      fullName: ctx.user.fullName,
      role: ctx.user.role,
    },
  })),

  echo: publicProcedure
    .input(z.object({ message: z.string().min(1).max(200) }))
    .query(({ input }) => ({ echo: input.message })),

  onboarding: onboardingRouter,
  territories: territoriesRouter,
  segments: segmentsRouter,
  companies: companiesRouter,
  contacts: contactsRouter,
  products: productsRouter,
  users: usersRouter,
  opportunities: opportunitiesRouter,
  partnerEngagements: partnerEngagementsRouter,
  contracts: contractsRouter,
  alerts: alertsRouter,
  activities: activitiesRouter,
  tasks: tasksRouter,
  aiConfig: aiConfigRouter,
  reports: reportsRouter,
  inbox: inboxRouter,
  search: searchRouter,
  adminEmail: adminEmailRouter,
  partners: partnersRouter,
  documents: documentsRouter,
  templates: templatesRouter,
  proposals: proposalsRouter,
  approvals: approvalsRouter,
  approvalRules: approvalRulesRouter,
  contractsConfig: contractsConfigRouter,
  imports: importsRouter,
  push: pushRouter,
  theme: themeRouter,
});

export type AppRouter = typeof appRouter;
