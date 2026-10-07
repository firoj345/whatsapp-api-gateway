import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  BASE_URL: z.string().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'),
  MCP_GATEWAY_URL: z.string().optional().default(''),

  // Security & Encryption
  ENCRYPTION_KEY: z.string().default('whatsapp-super-secret-key-32-chars!'),
  ADMIN_API_KEY: z.string().default('wag_live_admin_secret_key_demo_12345'),

  // PostgreSQL
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/whatsapp_gateway'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // AI & Voice (Free APIs)
  GEMINI_API_KEY: z.string().optional().default(''),
  GROQ_API_KEY: z.string().optional().default(''),
  WHISPER_URL: z.string().default('http://localhost:8000/v1/audio/transcriptions'),
  OPENAI_API_KEY: z.string().optional().default(''),
  POLLINATIONS_API_KEY: z.string().optional().default(''),
  HUGGINGFACE_API_KEY: z.string().optional().default(''),

  // Safety & Anti-Ban defaults
  TYPING_SPEED_MS_PER_CHAR: z.coerce.number().default(45),
  MIN_DELAY_BETWEEN_MESSAGES_MS: z.coerce.number().default(2000),
  MAX_DELAY_BETWEEN_MESSAGES_MS: z.coerce.number().default(5000),
  MAX_MESSAGES_PER_MINUTE: z.coerce.number().default(20),
  MAX_MESSAGES_PER_DAY: z.coerce.number().default(500),
  WARMUP_MODE_ENABLED: z.coerce.boolean().default(true),

  // Storage
  MEDIA_STORAGE_PATH: z.string().default('./data/media'),
  SESSION_STORAGE_PATH: z.string().default('./data/sessions'),

  // AWS S3 Storage (Primary)
  AWS_REGION: z.string().default('ap-southeast-2'),
  AWS_S3_BUCKET: z.string().default('klz-api-gateway-s3-storage-384627056855-ap-southeast-2-an'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_SESSION_TOKEN: z.string().optional().default(''),
  AWS_S3_PUBLIC_URL: z.string().optional().default(''),
  AWS_S3_USE_PRESIGNED_URLS: z.coerce.boolean().default(true),
   
  // Cloudflare R2 Storage (S3-Compatible Alternative)
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET_NAME: z.string().default('whatsapp-media'),
  R2_PUBLIC_URL: z.string().optional().default('')
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (error: any) {
  console.warn('⚠️ Warning: Environment validation issues detected, using defaults:', error?.issues || error);
  parsedEnv = envSchema.parse({});
}

export const env = parsedEnv;
