import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLazyPool } from '../src/db.js';

const exec = promisify(execFile);

test('todos os pontos de entrada exportam a mesma aplicação válida para a Vercel', async () => {
  const env = { ...process.env, VERCEL: '1', NODE_ENV: 'production' };
  for (const key of ['DATABASE_URL', 'APP_ORIGIN', 'TRUST_PROXY', 'NODE_OPTIONS']) delete env[key];
  const code = `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import app from './api/index.js';
    import detectedApp from './src/app.js';
    import serverApp from './server.js';
    assert.equal(app, detectedApp);
    assert.equal(app, serverApp);
    assert.equal(typeof app, 'function');
    assert.equal(app.get('trust proxy'), 1);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      for (const path of ['/', '/admin', '/assets/admin.css', '/assets/admin.js', '/assets/registration.js']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
      }
      for (const path of ['/.env', '/certs/supabase-ca.crt', '/src/db.js', '/server.js']) {
        assert.equal((await fetch(base + path)).status, 404, path);
      }
      assert.equal((await fetch(base + '/api/admin/inscricoes')).status, 401);
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.10', Origin: base.replace('http:', 'https:') },
        body: JSON.stringify({ nome: 'Pessoa Teste', telefone: '+5581999991234', curso: 'sites-ia' })
      };
      const unavailable = await fetch(base + '/api/inscricoes', options);
      assert.equal(unavailable.status, 503, 'banco ausente gera erro controlado, não erro de origem');
      assert.equal((await unavailable.json()).sucesso, false);
      assert.equal((await fetch(base + '/api/inscricoes', { ...options,
        headers: { ...options.headers, Origin: 'https://outro-site.example' } })).status, 403);
      assert.equal((await fetch(base + '/')).status, 200, 'erro de banco não derruba as páginas');
      console.log('handler-ok');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `;
  const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.match(stdout, /handler-ok/);
  assert.match(stderr, /DATABASE_URL_MISSING/);
});

test('pool sob demanda reutiliza a conexão e permite recuperação após configuração ausente', async () => {
  let attempts = 0;
  let closed = false;
  const db = { query: async value => value, end: async () => { closed = true; } };
  const pool = createLazyPool(() => {
    attempts++;
    if (attempts === 1) throw new Error('configuração ausente');
    return db;
  });
  assert.equal(attempts, 0);
  await assert.rejects(pool.query('first'), /configuração ausente/);
  assert.deepEqual(await Promise.all([pool.query('second'), pool.query('third')]), ['second', 'third']);
  assert.equal(attempts, 2);
  await pool.end();
  assert.equal(closed, true);
});
