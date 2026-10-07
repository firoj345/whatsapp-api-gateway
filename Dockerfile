# ==========================================================
# Stage 1: Build TypeScript Backend
# ==========================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code and database migrations
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# ==========================================================
# Stage 2: Production Runtime
# ==========================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install ffmpeg for WhatsApp voice note and audio processing
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Create persistent storage directories for sessions, media, and RAG vector store
RUN mkdir -p /app/data/sessions /app/data/media

# NOTE: Railway does not support VOLUME instructions.
# To persist /app/data across deploys, add a Railway Volume
# mounted at /app/data via the Railway dashboard.

EXPOSE 3000

# Start WhatsApp API Gateway
CMD ["node", "dist/server.js"]
