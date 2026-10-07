import postgres from 'postgres';
import { env } from '../config/env.js';
import { logger } from '../infra/logger.js';

export async function runMigrations() {
  logger.info('🚀 Running database schema initialization...');

  const sql = postgres(env.DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => { }
  });

  try {
    // 1. Sessions table
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone_number TEXT,
        status TEXT NOT NULL DEFAULT 'INITIALIZING',
        should_be_running BOOLEAN NOT NULL DEFAULT true,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 2. Encrypted Baileys Auth Store table
    await sql`
      CREATE TABLE IF NOT EXISTS baileys_auth (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        data_type TEXT NOT NULL,
        key_id TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 3. Messages table
    await sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        sender_jid TEXT,
        direction TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        media_url TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        idempotency_key TEXT,
        metadata JSONB DEFAULT '{}',
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 4. Webhooks & Outbox Deliveries
    await sql`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events JSONB NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event TEXT NOT NULL,
        payload JSONB NOT NULL,
        signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 8,
        response_status INT,
        last_error TEXT,
        next_retry_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 5. API Keys & Chat Permissions
    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        scopes JSONB NOT NULL,
        session_ids JSONB DEFAULT '[]',
        rate_limit_rpm INT DEFAULT 60,
        expires_at TIMESTAMP WITH TIME ZONE,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS key_chat_permissions (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        chat_jid_pattern TEXT NOT NULL,
        can_read BOOLEAN NOT NULL DEFAULT true,
        can_send BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 6. Demo ERP Tables & Voice Audit Logs
    await sql`
      CREATE TABLE IF NOT EXISTS erp_products (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        stock_qty INT NOT NULL DEFAULT 0,
        price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        category TEXT NOT NULL DEFAULT 'General',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS erp_sales (
        id TEXT PRIMARY KEY,
        order_number TEXT NOT NULL,
        item_name TEXT NOT NULL,
        sku TEXT NOT NULL,
        quantity INT NOT NULL,
        total_amount NUMERIC(10,2) NOT NULL,
        sale_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        customer_phone TEXT
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS voice_audit_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        audio_url TEXT,
        transcript TEXT NOT NULL,
        detected_intent TEXT NOT NULL,
        parameters JSONB DEFAULT '{}',
        query_sql TEXT,
        answer TEXT NOT NULL,
        latency_ms INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS bot_configs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        chat_jid_pattern TEXT NOT NULL DEFAULT '*',
        system_prompt TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'gemini',
        model TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
        is_active BOOLEAN NOT NULL DEFAULT true,
        max_consecutive_replies INT NOT NULL DEFAULT 5,
        handoff_keywords JSONB DEFAULT '["agent","human","support"]',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 12. RAG Knowledge Documents Table
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        raw_text TEXT NOT NULL,
        chunk_count INT NOT NULL DEFAULT 0,
        access_level INT NOT NULL DEFAULT 1,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 13. RAG Knowledge Chunks Table with Vector Embeddings
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding JSONB NOT NULL,
        token_count INT NOT NULL DEFAULT 0,
        access_level INT NOT NULL DEFAULT 1,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Safe migration: Add access_level column to existing tables if missing
    await sql`
      ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS access_level INT NOT NULL DEFAULT 1;
    `.catch(() => { });
    await sql`
      ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS access_level INT NOT NULL DEFAULT 1;
    `.catch(() => { });

    logger.info('✅ Database schema initialized successfully');
  } catch (err: any) {
   console.error("DATABASE MIGRATION ERROR:", err);
    console.error("DATABASE MIGRATION ERROR JSON:", JSON.stringify(err, null, 2));

    logger.warn(
        { err },
        "Database migration could not connect (proceeding with local runtime)"
    );
  } finally {
    await sql.end().catch(() => { });
  }
}

// Direct execution
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations().then(() => process.exit(0));
}
