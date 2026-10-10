require('dotenv').config();

const crypto = require('crypto');
const http = require('http');
const cors = require('cors');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});
const leads = [];
const pendingLeadIds = new Set();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    },
  }),
);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/leads', (req, res) => {
  res.json(leads);
});

app.get('/debug/fake-lead', (req, res) => {
  const firstNames = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey'];
  const lastNames = ['Smith', 'Johnson', 'Brown', 'Davis', 'Wilson'];
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const id = crypto.randomUUID();
  const lead = {
    leadgen_id: `fake-${id}`,
    full_name: `${firstName} ${lastName}`,
    email: `${firstName}.${lastName}.${id.slice(0, 8)}@example.com`.toLowerCase(),
    phone: `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`,
  };

  saveLead(lead);
  res.status(201).json(lead);
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('GET /webhook verification request', {
    mode,
    verifyTokenProvided: typeof verifyToken === 'string',
    challengeProvided: typeof challenge === 'string',
  });

  if (
    mode === 'subscribe' &&
    process.env.VERIFY_TOKEN &&
    verifyToken === process.env.VERIFY_TOKEN
  ) {
    console.log('GET /webhook verification successful');
    return res.status(200).type('text/plain').send(challenge);
  }

  console.log('GET /webhook verification failed');
  return res.sendStatus(403);
});

function isValidSignature(signatureHeader, rawBody) {
  if (
    !process.env.APP_SECRET ||
    !Buffer.isBuffer(rawBody) ||
    typeof signatureHeader !== 'string' ||
    !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)
  ) {
    return false;
  }

  const receivedSignature = Buffer.from(signatureHeader.slice(7), 'hex');
  const expectedSignature = crypto
    .createHmac('sha256', process.env.APP_SECRET)
    .update(rawBody)
    .digest();

  return (
    receivedSignature.length === expectedSignature.length &&
    crypto.timingSafeEqual(receivedSignature, expectedSignature)
  );
}

function createLeadMetadata(value) {
  return {
    leadgen_id: value.leadgen_id,
    form_id: value.form_id,
    page_id: value.page_id,
    created_time: value.created_time,
  };
}

function extractFieldData(fieldData) {
  if (!Array.isArray(fieldData)) {
    return {};
  }

  return Object.fromEntries(
    fieldData
      .filter((field) => field && typeof field.name === 'string')
      .map((field) => [
        field.name,
        Array.isArray(field.values) ? field.values[0] : field.values,
      ]),
  );
}

function saveLead(lead) {
  const receivedLead = {
    ...lead,
    received_at: new Date().toISOString(),
  };
  leads.unshift(receivedLead);
  console.log('Lead stored in memory', { leadgen_id: receivedLead.leadgen_id });
  io.emit('new_lead', receivedLead);
  console.log('Emitted new_lead event', { leadgen_id: receivedLead.leadgen_id });
}

async function processWebhook(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  console.log('Processing webhook entries', { count: entries.length });

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    console.log('Processing entry changes', { count: changes.length });

    for (const change of changes) {
      if (change?.field !== 'leadgen') {
        console.log('Skipping non-leadgen change', { field: change?.field });
        continue;
      }

      const value = change.value;
      const leadgenId = value?.leadgen_id;
      if (leadgenId === undefined || leadgenId === null) {
        console.log('Skipping leadgen change without leadgen_id');
        continue;
      }

      const leadIdKey = String(leadgenId);
      if (
        pendingLeadIds.has(leadIdKey) ||
        leads.some((lead) => String(lead.leadgen_id) === leadIdKey)
      ) {
        console.log('Skipping duplicate lead', { leadgen_id: leadgenId });
        continue;
      }

      pendingLeadIds.add(leadIdKey);
      console.log('Fetching lead details from Graph API', {
        leadgen_id: leadgenId,
      });

      try {
        const url = new URL(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}`,
        );
        url.searchParams.set('access_token', process.env.PAGE_TOKEN || '');

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Graph API returned HTTP ${response.status}`);
        }

        const leadDetails = await response.json();
        const lead = {
          ...createLeadMetadata(value),
          ...extractFieldData(leadDetails.field_data),
        };

        console.log('Graph API lead details received', {
          leadgen_id: leadgenId,
        });
        saveLead(lead);
      } catch (error) {
        console.log('Graph API lead lookup failed', {
          leadgen_id: leadgenId,
          error: error.message,
        });
        saveLead({
          ...createLeadMetadata(value),
          error: true,
        });
      } finally {
        pendingLeadIds.delete(leadIdKey);
      }
    }
  }
}

app.post('/webhook', (req, res) => {
  console.log('POST /webhook received');

  if (!isValidSignature(req.get('X-Hub-Signature-256'), req.rawBody)) {
    console.log('POST /webhook rejected: invalid signature');
    return res.sendStatus(401);
  }

  console.log('POST /webhook signature verified');
  res.sendStatus(200);

  setImmediate(() => {
    processWebhook(req.body).catch((error) => {
      console.error('Unexpected webhook processing error', error);
    });
  });
});

server.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
