import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),

  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Redis (BullMQ)
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL_HAIKU: z.string().default('claude-haiku-4-5-20251001'),
  ANTHROPIC_MODEL_SONNET: z.string().default('claude-sonnet-4-6'),

  // Perplexity (benchmarks)
  PERPLEXITY_API_KEY: z.string().optional(),

  // Resend (email)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().email().default('noreply@crm.local'),

  // Storage (S3/R2)
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Stripe (billing)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Observabilidade
  SENTRY_DSN: z.string().url().optional(),
  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().optional(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  TENANT_FIELD_ENCRYPTION_KEY: z.string().min(32).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
