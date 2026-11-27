import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Vercel API returns a controlled 503 when Supabase credentials are missing', () => {
  const source = `
    import handler from './api/laboratory.js';
    const request = { method: 'GET', url: '/api/health', headers: { host: 'example.test' }, socket: { remoteAddress: '127.0.0.1', encrypted: false } };
    const response = {
      headersSent: false,
      writableEnded: false,
      writeHead(status) { this.statusCode = status; this.headersSent = true; return this; },
      end(body = '') { this.body = String(body); this.writableEnded = true; return this; }
    };
    await handler(request, response);
    console.log('RESULT ' + response.statusCode + ' ' + response.body);
  `;
  const env = { ...process.env, VERCEL: '1' };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SECRET_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 15_000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT 503/);
  assert.match(result.stdout, /Сервер базасына қосылу мүмкін болмады/);
});
