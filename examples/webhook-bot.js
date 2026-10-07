import http from 'http';

// Minimal 30-line Webhook -> LLM -> WhatsApp reply bot
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const API_KEY = process.env.ADMIN_API_KEY || 'wag_live_admin_secret_key_demo_12345';

http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { event, sessionId, data } = JSON.parse(body);
        if (event === 'message.received' && data?.type === 'text') {
          console.log(`[Bot] Incoming from ${data.from}: ${data.content}`);
          const reply = `🤖 Echo Bot: You said "${data.content}". Server time: ${new Date().toLocaleTimeString()}`;

          // Reply back through gateway
          await fetch(`${GATEWAY_URL}/sessions/${sessionId}/messages/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
            body: JSON.stringify({ to: data.chatJid, text: reply })
          });
        }
      } catch (e) { console.error('Error handling webhook:', e.message); }
      res.writeHead(200); res.end('OK');
    });
  } else { res.writeHead(404); res.end(); }
}).listen(4000, () => console.log('🚀 30-line Bot listening on http://localhost:4000'));
