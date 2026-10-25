import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware.js';
import chat from './routes/chat.js';

const app = new Hono();

// PRD Section 12.5, 12.6: Security and Privacy Headers
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.use('*', authMiddleware);

// Routes
app.route('/v1/chat', chat);

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;