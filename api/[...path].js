import { handleRequest, store } from '../server.mjs';

let requestQueue = Promise.resolve();

export default async function handler(request, response) {
  const run = requestQueue.then(async () => {
    await store.ready;
    await store.refresh();
    await handleRequest(request, response);
  });
  requestQueue = run.catch(() => undefined);
  try {
    await run;
  } catch (error) {
    console.error('Vercel API request failed:', request.method, error?.name || 'Error');
    if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (!response.writableEnded) response.end(JSON.stringify({ error: 'Сервер базасына қосылу мүмкін болмады.' }));
  }
}
