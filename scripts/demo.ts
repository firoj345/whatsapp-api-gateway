import { env } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDemoData } from '../src/db/seed.js';

async function runDemoSetup() {
  console.log('====================================================');
  console.log('🎉 48-HOUR HACKATHON: WHATSAPP API GATEWAY DEMO READY');
  console.log('====================================================\n');

  try {
    await runMigrations();
    await seedDemoData();
  } catch {}

  console.log('🚀 SYSTEM STATUS:');
  console.log(`• Dashboard URL:         ${env.BASE_URL}`);
  console.log(`• OpenAPI / Swagger Docs: ${env.BASE_URL}/docs`);
  console.log(`• Prometheus /metrics:    ${env.BASE_URL}/metrics`);
  console.log(`• Admin API Key:          ${env.ADMIN_API_KEY}\n`);

  console.log('📋 QUICK CURL COMMANDS:');
  console.log(`1. Create Session:`);
  console.log(`   curl -X POST ${env.BASE_URL}/sessions \\`);
  console.log(`     -H "Authorization: Bearer ${env.ADMIN_API_KEY}" \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"id": "demo-session-1", "name": "Hackathon Demo Line"}'\n`);

  console.log(`2. Get QR Code for Pairing:`);
  console.log(`   curl -X GET ${env.BASE_URL}/sessions/demo-session-1/qr \\`);
  console.log(`     -H "Authorization: Bearer ${env.ADMIN_API_KEY}"\n`);

  console.log(`3. Send Message with Anti-Ban Pacing & 202 Accepted:`);
  console.log(`   curl -X POST ${env.BASE_URL}/sessions/demo-session-1/messages/text \\`);
  console.log(`     -H "Authorization: Bearer ${env.ADMIN_API_KEY}" \\`);
  console.log(`     -H "Idempotency-Key: demo-key-101" \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"to": "1234567890@s.whatsapp.net", "text": "Hello from WhatsApp Gateway!"}'\n`);

  console.log(`4. Test Voice-to-Database / ERP Query:`);
  console.log(`   curl -X POST ${env.BASE_URL}/erp/query \\`);
  console.log(`     -H "Authorization: Bearer ${env.ADMIN_API_KEY}" \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"query": "How many MacBook units are in stock?"}'\n`);

  console.log('====================================================\n');
  process.exit(0);
}

runDemoSetup();
