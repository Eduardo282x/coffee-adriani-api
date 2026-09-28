import * as Joi from 'joi';

const DEFAULT_ORIGINS = [
  'https://cafe-adriani.duckdns.org',
  'https://cafe-adriani-frontend-xnvayt-d5ec0a-185-237-253-171.sslip.io',
  'http://localhost:5173',
];

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  JWT_SECRET: Joi.string().min(32).required(),

  PORT: Joi.number().port().default(3002),

  N8N_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
  N8N_URL: Joi.string().uri().allow('').optional(),

  // Tolerancia (USD) por debajo de la cual una factura se considera pagada.
  // Regla de negocio intencional: absorbe el redondeo de conversiones BS/USD.
  PAYMENT_TOLERANCE_USD: Joi.number().min(0).default(2),

  // Pool de conexiones. Despliegue de una sola instancia, sin PgBouncer.
  DB_POOL_MAX: Joi.number().integer().min(1).max(100).default(20),
  DB_POOL_IDLE_TIMEOUT: Joi.number().integer().min(0).default(30_000),
  DB_CONNECT_TIMEOUT: Joi.number().integer().min(0).default(10_000),

  // Lista separada por comas. En produccion NUNCA debe incluir localhost.
  CORS_ORIGINS: Joi.string().optional(),

  // Saltos de proxy inverso delante de la app (Dokploy = 1 Traefik).
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(1),

  // Access token corto + refresh rotatorio.
  ACCESS_TOKEN_TTL: Joi.number().integer().min(60).default(900),
  REFRESH_TOKEN_TTL: Joi.number().integer().min(300).default(604_800),

  // Umbral absoluto (no porcentual) de stock bajo para el dashboard.
  LOW_STOCK_THRESHOLD: Joi.number().min(0).default(10),

  BUSINESS_TZ: Joi.string().default('America/Caracas'),
});

export function resolveCorsOrigins(
  raw: string | undefined,
  isProduction: boolean,
) {
  const configured = raw
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins = configured?.length ? configured : DEFAULT_ORIGINS;

  if (!isProduction) {
    return origins;
  }

  return origins.filter(
    (origin) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin),
  );
}
