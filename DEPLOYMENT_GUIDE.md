# Complete Docker & Free-Tier Cloud Deployment Guide

This guide details how to containerize and deploy both the **Fastify Backend API Gateway** and the **Next.js 14 Web Dashboard** using **100% Free Tiers**.

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    Client[Web Browser / User] -->|Port 3001| Frontend[Next.js Dashboard Container]
    Frontend -->|REST API Requests| Backend[Fastify API Gateway Container]
    WhatsApp[WhatsApp Network] <-->|Baileys Persistent WebSocket| Backend
    Backend <-->|Drizzle ORM| Postgres[(PostgreSQL 16 DB)]
    Backend <-->|BullMQ & Anti-Ban Pacing| Redis[(Redis 7 Cache)]
    Backend <-->|Auth Tokens & Media| VolData[Persistent Storage /app/data]
```

---

## 🚀 Part 1: Run Locally with Docker Compose

Running everything in Docker on your local machine takes just one command:

### 1. Configure Environment
Copy the example environment file:
```bash
cp .env.docker.example .env
```

### 2. Build and Launch Containers
```bash
docker compose up --build -d
```

### 3. Check Running Services
```bash
docker compose ps
```
You will see 4 containers running:
- **`whatsapp_frontend`**: `http://localhost:3001` (Dashboard)
- **`whatsapp_backend`**: `http://localhost:3000` (Fastify Gateway & API Docs)
- **`whatsapp_postgres`**: `localhost:5432`
- **`whatsapp_redis`**: `localhost:6379`

### 4. Verify Endpoints
- **Web Dashboard**: [http://localhost:3001](http://localhost:3001)
- **Interactive Swagger Docs**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

### 5. Stop Containers
```bash
docker compose down
```
*(Your WhatsApp sessions and RAG vectors remain safe in the persistent `backend_data` volume).*

---

## ☁️ Part 2: 100% Free-Tier Cloud Deployment

For running in production for free, the optimal architecture separates stateless and stateful components:

| Component | Recommended Platform | Free Tier Specifications | Cost |
| :--- | :--- | :--- | :--- |
| **Frontend** | **Vercel** | Free global Edge CDN, auto SSL, unlimited preview deploys | **$0/mo** |
| **Backend** | **Render** or **Koyeb** | Docker Web Service, 512MB RAM, free public URL | **$0/mo** |
| **Database** | **Supabase** or **Neon** | 500MB PostgreSQL, connection pooling, SSL | **$0/mo** |
| **Redis** | **Upstash** | Serverless Redis, 10,000 commands/day | **$0/mo** |

---

### Step 1: Set Up Free Cloud Databases

#### A. Free PostgreSQL Database (Supabase or Neon)
1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Under **Project Settings → Database**, copy the **URI Connection string**:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
3. *(Alternative)* Go to [neon.tech](https://neon.tech) and copy your free serverless Postgres connection string.

#### B. Free Redis (Upstash)
1. Go to [upstash.com](https://upstash.com) and create a free Redis database.
2. In the database dashboard, copy the **`REDIS_URL`**:
   ```
   rediss://default:[YOUR-PASSWORD]@[ENDPOINT].upstash.io:6379
   ```

---

### Step 2: Deploy Backend to Render (Free Tier)

Render supports deploying from your GitHub repository using the included [`Dockerfile`](./Dockerfile) or [`render.yaml`](./render.yaml).

#### Option A: 1-Click Blueprint
1. Push your repository to GitHub.
2. In Render, click **New + → Blueprint**.
3. Select your repository. Render will automatically read [`render.yaml`](./render.yaml) and configure the web service.

#### Option B: Manual Web Service
1. In Render, click **New + → Web Service**.
2. Select your GitHub repository.
3. Choose **Docker** as the runtime.
4. Set the environment variables:
   - `PORT`: `3000`
   - `NODE_ENV`: `production`
   - `ADMIN_API_KEY`: *(Choose a secure secret key, e.g. `wag_live_admin_secret_123`)*
   - `ENCRYPTION_KEY`: *(Choose a 32+ character random string)*
   - `DATABASE_URL`: *(Your Supabase or Neon PostgreSQL URL)*
   - `REDIS_URL`: *(Your Upstash Redis URL)*
   - `GEMINI_API_KEY`: *(Your free Google AI Studio key)*
   - `GROQ_API_KEY`: *(Your free Groq key)*
5. Click **Create Web Service**.
6. When deployment finishes, copy your live backend URL (e.g. `https://whatsapp-backend.onrender.com`).

> [!TIP]
> **Prevent Free Tier Inactivity Sleep**:
> Free services on Render sleep after 15 minutes of inactivity. You can use a free monitoring service like [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com) to ping `https://your-backend.onrender.com/health` every 10 minutes. This keeps your WhatsApp connection alive 24/7!

---

### Step 3: Deploy Frontend Dashboard to Vercel (Free Tier)

Next.js is built by Vercel and runs on their free tier with zero server maintenance.

1. Go to [vercel.com](https://vercel.com) and click **Add New → Project**.
2. Import your GitHub repository.
3. In **Project Settings**:
   - **Root Directory**: Click *Edit* and select **`web`**.
   - **Framework Preset**: Next.js (detected automatically).
4. In **Environment Variables**, add:
   - `NEXT_PUBLIC_API_BASE_URL`: `https://your-backend.onrender.com` *(your live backend URL from Step 2)*
5. Click **Deploy**.
6. In ~60 seconds, your live dashboard will be active at `https://your-project.vercel.app`!

---

## 🌟 Part 3: All-in-One Deployment on Oracle Cloud Always Free (Recommended for Power Users)

If you want both frontend, backend, postgres, and redis running on a single dedicated virtual machine without sleeping or split services:

1. Create a free account at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
2. Create an **Ampere A1 Compute Instance** (Always Free Tier offers **4 ARM cores, 24 GB RAM, 200 GB SSD** for $0/forever).
3. Connect via SSH and install Docker:
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker ubuntu
   ```
4. Clone your repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/whatsapp-api.git
   cd whatsapp-api
   ```
5. Create your `.env` file from `.env.docker.example`:
   ```bash
   cp .env.docker.example .env
   # Edit with your secrets and public server IP/domain
   nano .env
   ```
6. Start everything in the background:
   ```bash
   docker compose up -d --build
   ```
7. Allow ports `80`, `443`, `3000`, `3001` in Oracle Cloud Security Lists / iptables.

---

## 🔒 Security Best Practices for Production

1. **Change the default Admin Key**:
   Never use `wag_live_admin_secret_key_demo_12345` in production. Generate a strong key:
   ```bash
   node -e "console.log('wag_live_' + require('crypto').randomBytes(24).toString('hex'))"
   ```
2. **Persistent Session Storage**:
   Always ensure `/app/data` is mounted to a Docker volume or persistent disk so that linked WhatsApp devices and RAG vector indexes do not get deleted on container recreation.
3. **CORS Configuration**:
   Fastify backend CORS allows `*` by default. For strict production security, update `origin` in [`src/app.ts`](./src/app.ts) to match your frontend domain (`https://your-dashboard.vercel.app`).
