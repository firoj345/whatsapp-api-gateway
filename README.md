# 🚀 WhatsApp API Gateway (Self-Hosted)

A high-speed, self-hosted, multi-account **WhatsApp API Gateway** built for the 48-Hour Internal Engineering Hackathon. This gateway enables company websites, internal apps, and automated AI bots to send and receive WhatsApp messages without expensive third-party vendor markups.

---

## 🏗️ Architecture & System Design

```
                     ┌───────────────────────────────────────────────┐
                     │            Clients & Microservices            │
                     │   (Webhooks, cURL, Internal Apps, MCP Tools)  │
                     └───────────────────────┬───────────────────────┘
                                             │ HTTP REST / SSE / MCP
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │          Fastify API & Auth Guard             │
                     │  - API Key SHA-256 Auth & Chat ACL Filter     │
                     │  - Swagger OpenAPI Docs (/docs)               │
                     │  - Prometheus Metrics (/metrics)              │
                     └───────┬───────────────────────────────┬───────┘
                             │                               │
                      Inbound│                         Outbound (202 Accepted)
                             ▼                               ▼
               ┌───────────────────────────┐   ┌───────────────────────────┐
               │    Inbound Coordinator    │   │      Redis / BullMQ       │
               │  - Outbox Webhook Dispatch│   │   - Per-Session Queues    │
               │  - AI Auto-Reply Bot      │   │   - Idempotency Dedupe    │
               │  - Voice → ERP Query      │   └─────────────┬─────────────┘
               └─────────────┬─────────────┘                 │
                             │                               ▼
                             │                 ┌───────────────────────────┐
                             │                 │    SafetyPolicy Worker    │
                             │                 │  - Typing Simulation Jitter│
                             │                 │  - Randomized 2-5s Pacing │
                             │                 │  - Circuit Breakers       │
                             └───────────┬─────┴───────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────────────┐
                     │      MessageProvider Abstraction Layer       │
                     │  ┌─────────────────────┐  ┌────────────────┐  │
                     │  │ Baileys Engine (Web)│  │ Meta Cloud API │  │
                     │  │ (Active Driver)     │  │ (Pluggable)    │  │
                     │  └─────────────────────┘  └────────────────┘  │
                     └───────────────────┬───────────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
       ┌────────────────────────┐                ┌────────────────────────┐
       │ PostgreSQL (Drizzle)   │                │ faster-whisper Sidecar │
       │ - Encrypted Auth Store │                │ - 16kHz WAV STT        │
       │ - Message & Outbox Log │                │ - Free Groq / Gemini   │
       │ - ERP Products & Sales │                └────────────────────────┘
       └────────────────────────┘
```

> [!IMPORTANT]
> **Production Thinking & ToS Compliance Notice:**
> This gateway uses Baileys (`@whiskeysockets/baileys`) for WhatsApp Web WebSocket communication. Because unofficial WhatsApp Web automation carries potential Terms of Service risks, the entire dispatch engine is architected behind the abstract [`IMessageProvider`](file:///src/modules/messages/provider.interface.ts) interface. This allows enterprises to hot-swap to the official WhatsApp Business Cloud API with zero changes to business logic or client endpoints.

---

## 🌟 Key Features

1. **Multi-Account Support (Multiple Sessions)**:
   - Run multiple WhatsApp numbers simultaneously on a single gateway instance.
   - Interactive QR code pairing with live Server-Sent Events (SSE) stream or 8-digit pairing code.
   - **Custom PostgreSQL Auth State Storage** (AES-256-GCM encrypted): survives container restarts with no re-scanning required.

2. **How Automatic Reconnection Works**:
   - **`loggedOut`**: Identifies user logout via `DisconnectReason.loggedOut`, marks session as `LOGGED_OUT`, purges credentials, and dispatches a webhook without retry.
   - **Network Drops & Connection Loss**: Triggers exponential backoff with randomized jitter (`1s -> 2s -> 4s ... capped at 60s`), and resets the retry counter after 30 seconds of stable connection.
   - **Watchdog Heartbeat**: Periodically audits connected sockets. If a socket claims to be open but receives no events for >5 minutes, the watchdog recycles and reconnects the connection.
   - **Boot Recovery**: On gateway startup, all sessions marked `should_be_running` are automatically loaded and reconnected with a staggered launch.

3. **REST API for Messages (Async 202 Accepted)**:
   - Send text, images, PDF documents, voice notes (Push-To-Talk OGG/Opus), and emoji reactions.
   - Immediate `202 Accepted` response with `messageId` and status `queued`.
   - Contact verification via `onWhatsApp()` before sending to eliminate spam flags.
   - `Idempotency-Key` header prevents duplicate dispatches.
   - Interactive Swagger docs at `http://localhost:3000/docs`.

4. **Real-Time Webhooks with Outbox Pattern**:
   - Guaranteed event delivery (`message.received`, `message.status`, `session.status`, `session.qr`).
   - HMAC-SHA256 signature verification (`X-Signature: sha256=<hex>`).
   - Durable PostgreSQL outbox queue with BullMQ retries (exponential backoff up to 8 attempts) and dead-letter auditing.

5. **Voice-to-Database / ERP Query Pipeline**:
   - Spoken question audio (e.g. *"How many units of MacBook are in stock?"* or *"What was today's total sales?"*) is downloaded and transcribed via Whisper (Free Groq API or self-hosted sidecar).
   - Safe tool/intent parser matches parameterized queries from [`erpCatalog`](file:///src/modules/erp/catalog.ts) (`get_stock`, `get_sales_total`, `get_top_products`).
   - Replies back automatically to WhatsApp in natural language and records audit logs. 

6. **Secure API Keys & Chat-Level Permissions (ACL)**:
   - Scoped keys generated as `wag_live_<token>` (stored as SHA-256 hashes).
   - Chat-level ACL guards enforce reading and sending permissions per JID pattern at both request time and repository layer.

7. **Anti-Ban Safety & Pacing (`SafetyPolicy`)**:
   - Human typing simulation (`presence: composing`, 40–60ms per character ±20% jitter clamped between 1–8s).
   - Randomized gaps (2–5s) between queue dispatches.
   - Multi-tier rate limiting (per-minute, per-hour, per-day) in Redis with automatic warm-up mode for new numbers.
   - Circuit breakers trip on consecutive send errors to protect lines.

8. **AI Chatbot Ready & Model Context Protocol (MCP)**:
   - `/sessions/:id/chats/:jid/context` endpoint provides clean LLM-formatted conversation history (`role: user | assistant`).
   - Built-in Auto-Reply Bot with loop guards (ignores own messages, caps consecutive replies, human-handoff keywords).
   - MCP stdio server (`src/mcp/server.ts`) using the official SDK for clients such as Cursor.

### Connect Cursor to the MCP server

1. Install dependencies with `npm install` and configure `.env` for the gateway's PostgreSQL and Redis services. The MCP process calls the running gateway API using `ADMIN_API_KEY`; it defaults to `http://127.0.0.1:PORT` and can be pointed elsewhere with `MCP_GATEWAY_URL`.
2. Start the gateway and its services (for example, with `docker compose up -d`).
3. Open this repository in Cursor. Its project MCP configuration is `.cursor/mcp.json`; select **Reload** for `klizo-whatsapp` in Cursor's MCP settings.

The server exposes WhatsApp session, chat, and message tools, plus ERP inventory search. Sending a message has a real-world side effect. Keep the gateway running while using the MCP server.

---

## ⚡ One-Command Setup

### Option 1: Docker Compose (Production / Judges)

```bash
# 1. Clone & copy environment configuration
cp .env.example .env

# 2. Launch Gateway, PostgreSQL, Redis, and Whisper
docker compose up -d

# 3. Seed demo credentials & view dashboard
npm run demo
```

The gateway will automatically execute database migrations on boot and become available at:
- **Admin Dashboard**: [http://localhost:3000](http://localhost:3000)
- **OpenAPI / Swagger**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Prometheus Metrics**: [http://localhost:3000/metrics](http://localhost:3000/metrics)

---

### Option 2: Local Development Mode

```bash
# Install dependencies
npm install --ignore-scripts

# Start development server
npm run dev
```

---

## 📋 cURL Quick Reference

### 1. Create a WhatsApp Session
```bash
curl -X POST http://localhost:3000/sessions \
  -H "Authorization: Bearer wag_live_admin_secret_key_demo_12345" \
  -H "Content-Type: application/json" \
  -d '{"id": "sales-line-1", "name": "Main Sales Line"}'
```

### 2. View QR Code for Pairing (SSE or PNG)
```bash
# As PNG image
curl -X GET http://localhost:3000/sessions/sales-line-1/qr \
  -H "Authorization: Bearer wag_live_admin_secret_key_demo_12345" \
  -H "Accept: image/png" --output qr.png

# As Server-Sent Events (SSE)
curl -N http://localhost:3000/sessions/sales-line-1/qr \
  -H "Authorization: Bearer wag_live_admin_secret_key_demo_12345" \
  -H "Accept: text/event-stream"
```

### 3. Send Text Message (Async 202 Accepted)
```bash
curl -X POST http://localhost:3000/sessions/sales-line-1/messages/text \
  -H "Authorization: Bearer wag_live_admin_secret_key_demo_12345" \
  -H "Idempotency-Key: send-001" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "14155552671",
    "text": "Hello! Your invoice #1042 is ready for review."
  }'
```

### 4. Query ERP Database (Voice or Text Simulation)
```bash
curl -X POST http://localhost:3000/erp/query \
  -H "Authorization: Bearer wag_live_admin_secret_key_demo_12345" \
  -H "Content-Type: application/json" \
  -d '{"query": "How many units of MacBook are in stock?"}'
```

### 5. Generate a Restricted API Key
```bash
curl -X POST http://localhost:3000/auth/keys \
  -H "Authorization: Bearer wag_live_admin_secret_key_demo_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Support Bot",
    "scopes": ["messages:send", "messages:read"],
    "rateLimitRpm": 30
  }'
```

---

## 🎬 7-Step Hackathon Demo Script

1. Run `docker compose up -d` and visit the dashboard at `http://localhost:3000`.
2. Click **"+ Add New Session"**, scan the displayed QR code with WhatsApp, and show the session moving to `CONNECTED`.
3. Send a message with `curl` or the dashboard message composer, observing the human typing indicator and pacing delay.
4. Reply from your phone and observe the real-time webhook payload firing in the stream.
5. Send a voice note asking: *"How many units of MacBook are in stock?"* to see the automated STT + ERP lookup return the real stock count.
6. Simulate a network drop (`docker network disconnect ...`), restore it, and demonstrate the socket reconnecting with zero re-scanning.
7. Test an API key restricted by chat JID to demonstrate a clean `403 Forbidden` response.
