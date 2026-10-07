import client from 'prom-client';

// Collect default Node.js & runtime metrics
client.collectDefaultMetrics({ prefix: 'wag_' });

export const messageSentCounter = new client.Counter({
  name: 'wag_messages_sent_total',
  help: 'Total messages sent through the gateway',
  labelNames: ['session_id', 'type', 'status']
});

export const messageReceivedCounter = new client.Counter({
  name: 'wag_messages_received_total',
  help: 'Total messages received from WhatsApp',
  labelNames: ['session_id', 'type']
});

export const sessionStatusGauge = new client.Gauge({
  name: 'wag_sessions_status',
  help: 'Status of WhatsApp sessions (1=CONNECTED, 0=OTHER)',
  labelNames: ['session_id', 'status']
});

export const reconnectCounter = new client.Counter({
  name: 'wag_reconnect_attempts_total',
  help: 'Total reconnection attempts made by session managers',
  labelNames: ['session_id', 'reason']
});

export const webhookDeliveryCounter = new client.Counter({
  name: 'wag_webhook_deliveries_total',
  help: 'Total webhook deliveries attempted',
  labelNames: ['event', 'status']
});

export const voiceQueryDurationHistogram = new client.Histogram({
  name: 'wag_voice_query_duration_seconds',
  help: 'Time taken to transcribe and answer a voice ERP query',
  buckets: [0.2, 0.5, 1, 2, 5, 10]
});

export const metricsRegistry = client.register;
