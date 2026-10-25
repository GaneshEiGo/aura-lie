import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AuraLieLoop } from '@aura-lie/core';

const chat = new Hono();

chat.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const loop = new AuraLieLoop(c.env);

    return streamSSE(c, async (stream) => {
      try {
        for await (const event of loop.processMessage(body)) {
          await stream.writeSSE({ 
            event: event.t, 
            data: JSON.stringify(event) 
          });
        }
      } catch (streamErr: any) {
        await stream.writeSSE({ 
          event: 'error', 
          data: JSON.stringify({ t: 'error', code: 'STREAM_FAILED', userMessage: 'An unexpected error occurred.' }) 
        });
      }
    });
  } catch (err) {
    return c.json({ error: 'Invalid request' }, 400);
  }
});

export default chat;