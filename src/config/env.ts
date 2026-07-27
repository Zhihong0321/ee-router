import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ADMIN_API_KEY: z.string().min(32).optional(),
  PROVIDER_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex value').optional(),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  REQUEST_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['DATABASE_URL', 'ADMIN_API_KEY', 'PROVIDER_ENCRYPTION_KEY'] as const) {
    if (!env[key]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'is required in production' });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  return result.data;
}
