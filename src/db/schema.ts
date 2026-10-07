import { pgTable, text, timestamp, boolean, integer, jsonb, decimal } from 'drizzle-orm/pg-core';

export const sessionsTable = pgTable('sessions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phoneNumber: text('phone_number'),
  status: text('status').notNull().default('INITIALIZING'), // INITIALIZING, QR_PENDING, CONNECTED, RECONNECTING, LOGGED_OUT
  shouldBeRunning: boolean('should_be_running').notNull().default(true),
  config: jsonb('config').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// Baileys Auth Store in Postgres (encrypted)
export const baileysAuthTable = pgTable('baileys_auth', {
  id: text('id').primaryKey(), // session_id:data_type:key_id
  sessionId: text('session_id').notNull(),
  dataType: text('data_type').notNull(), // 'creds' or signal keys ('pre-key', 'session', etc.)
  keyId: text('key_id').notNull(),
  encryptedValue: text('encrypted_value').notNull(), // AES-256-GCM ciphertext + iv + tag
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const messagesTable = pgTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  chatJid: text('chat_jid').notNull(),
  senderJid: text('sender_jid'),
  direction: text('direction').notNull(), // 'inbound' | 'outbound'
  type: text('type').notNull(), // 'text' | 'image' | 'document' | 'voice' | 'reaction'
  content: text('content'),
  mediaUrl: text('media_url'),
  status: text('status').notNull().default('queued'), // queued, sent, delivered, read, failed
  idempotencyKey: text('idempotency_key'),
  metadata: jsonb('metadata').default({}),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const webhooksTable = pgTable('webhooks', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'), // null for all sessions
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: jsonb('events').$type<string[]>().notNull(), // e.g. ['message.received', 'message.status', 'session.status', 'session.qr']
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const webhookDeliveriesTable = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  signature: text('signature').notNull(),
  status: text('status').notNull().default('pending'), // pending, success, failed
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  responseStatus: integer('response_status'),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const apiKeysTable = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(), // 'wag_live_abc1'
  keyHash: text('key_hash').notNull(), // sha256 hash
  scopes: jsonb('scopes').$type<string[]>().notNull(), // ['messages:send', 'messages:read', 'sessions:manage', '*']
  sessionIds: jsonb('session_ids').$type<string[]>().default([]), // allowed session IDs, ['*'] for all
  rateLimitRpm: integer('rate_limit_rpm').default(60),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const keyChatPermissionsTable = pgTable('key_chat_permissions', {
  id: text('id').primaryKey(),
  keyId: text('key_id').notNull(),
  sessionId: text('session_id').notNull(),
  chatJidPattern: text('chat_jid_pattern').notNull(), // e.g. '123456@s.whatsapp.net' or '*'
  canRead: boolean('can_read').notNull().default(true),
  canSend: boolean('can_send').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// Demo ERP tables for Voice Query Feature
export const erpProductsTable = pgTable('erp_products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  stockQty: integer('stock_qty').notNull().default(0),
  price: decimal('price', { precision: 10, scale: 2 }).notNull().default('0.00'),
  category: text('category').notNull().default('General'),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const erpSalesTable = pgTable('erp_sales', {
  id: text('id').primaryKey(),
  orderNumber: text('order_number').notNull(),
  itemName: text('item_name').notNull(),
  sku: text('sku').notNull(),
  quantity: integer('quantity').notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  saleDate: timestamp('sale_date').defaultNow().notNull(),
  customerPhone: text('customer_phone')
});

export const voiceAuditLogsTable = pgTable('voice_audit_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  senderJid: text('sender_jid').notNull(),
  audioUrl: text('audio_url'),
  transcript: text('transcript').notNull(),
  detectedIntent: text('detected_intent').notNull(),
  parameters: jsonb('parameters').default({}),
  querySql: text('query_sql'),
  answer: text('answer').notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const botConfigsTable = pgTable('bot_configs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  chatJidPattern: text('chat_jid_pattern').notNull().default('*'),
  systemPrompt: text('system_prompt').notNull(),
  provider: text('provider').notNull().default('gemini'), // gemini, groq, openai, ollama
  model: text('model').notNull().default('gemini-2.0-flash'),
  isActive: boolean('is_active').notNull().default(true),
  maxConsecutiveReplies: integer('max_consecutive_replies').notNull().default(5),
  handoffKeywords: jsonb('handoff_keywords').$type<string[]>().default(['agent', 'human', 'support']),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

// RAG Pipeline: Knowledge Documents Table
export const knowledgeDocumentsTable = pgTable('knowledge_documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  source: text('source').notNull().default('manual'), // manual, pdf, policy, faq, website
  rawText: text('raw_text').notNull(),
  chunkCount: integer('chunk_count').notNull().default(0),
  accessLevel: integer('access_level').notNull().default(1), // 1=Public, 2=Internal, 3=Confidential, 4=Restricted
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

// RAG Pipeline: Semantic Knowledge Chunks with Vector Embeddings
export const knowledgeChunksTable = pgTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  topic: text('topic').notNull(),
  content: text('content').notNull(),
  embedding: jsonb('embedding').$type<number[]>().notNull(), // Float vector representation
  tokenCount: integer('token_count').notNull().default(0),
  accessLevel: integer('access_level').notNull().default(1), // 1=Public, 2=Internal, 3=Confidential, 4=Restricted
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

