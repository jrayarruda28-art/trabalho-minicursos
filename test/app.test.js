import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword, hashToken } from '../src/security.js';

const origin = 'https://minicursos.example.test';
const validRegistration = { nome: 'Maria da Silva', telefone: '+5581999991234', curso: 'sites-ia' };

async function startApp(t, options = {}) {
  const app = createApp({ appOrigin: origin, secureCookies: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return (path, options = {}) => fetch(baseUrl + path, options);
}

function post(body, options = {}) {
  return { ...options, method: 'POST', headers: { 'content-type': 'application/json', origin, ...options.headers }, body: JSON.stringify(body) };
}

test('dados das inscrições não ficam acessíveis sem sessão administrativa', async (t) => {
  let queries = 0;
  const request = await startApp(t, { pool: { query: async () => { queries++; return { rows: [] }; } } });
  const response = await request('/api/admin/inscricoes');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).sucesso, false);
  assert.equal(queries, 0);
});

test('login inválido retorna erro e não cria cookie de autenticação', async (t) => {
  const request = await startApp(t, { pool: { query: async () => ({ rows: [] }) } });
  const response = await request('/api/admin/login', post({ usuario: 'inexistente', senha: 'incorreta' }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).sucesso, false);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('origem externa não pode executar ações no servidor', async (t) => {
  let queries = 0;
  const request = await startApp(t, { pool: { query: async () => { queries++; return { rows: [] }; } } });
  for (const path of ['/api/admin/login', '/api/admin/logout', '/api/inscricoes']) {
    const response = await request(path, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://site-externo.test' },
      body: JSON.stringify(path.includes('login') ? { usuario: 'admin', senha: 'admin000' } : validRegistration),
    });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).sucesso, false);
  }
  assert.equal(queries, 0);
});

test('arquivos internos e credenciais não são publicados pelo servidor', async (t) => {
  const request = await startApp(t, { pool: { query: async () => ({ rows: [] }) } });
  for (const path of ['/.env', '/.git/config', '/src/app.js', '/server.js', '/package.json']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
  }
});

test('falha no banco nunca confirma inscrição nem expõe detalhes internos', async (t) => {
  const internalError = new Error('password=segredo-interno host=banco-privado');
  const pool = { query: async () => { throw internalError; }, connect: async () => { throw internalError; } };
  const request = await startApp(t, { pool });
  const response = await request('/api/inscricoes', post(validRegistration));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.sucesso, false);
  assert.equal(typeof body.mensagem, 'string');
  assert.doesNotMatch(JSON.stringify(body), /segredo-interno|banco-privado/);
});

test('dados inválidos são rejeitados antes de acessar o banco', async (t) => {
  let connections = 0;
  const pool = {
    query: async () => { connections++; return { rows: [] }; },
    connect: async () => { connections++; throw new Error('banco não deveria ser acessado'); },
  };
  const request = await startApp(t, { pool });
  const response = await request('/api/inscricoes', post({ ...validRegistration, telefone: '123' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).sucesso, false);
  assert.equal(connections, 0);
});


async function adminPool() {
  const admin = { id: 1, usuario: 'admin', senha_hash: await hashPassword('admin000') };
  const sessions = new Map();
  const registrations = [
    { id: '1', nome: 'Maria da Silva', telefone: '+5581999991234', curso: 'sites-ia', criado_em: '2026-09-23T12:00:00.000Z' },
    { id: '2', nome: 'João Santos', telefone: '+5581999995678', curso: 'sites-ia', criado_em: '2026-09-23T12:01:00.000Z' },
  ];
  const courses = [
    { id: 'sites-ia', nome: 'Sites com IA', data: '29/09', capacidade: 25 },
    { id: 'impressao-3d', nome: 'Impressão 3D', data: '29/10', capacidade: 25 },
  ];
  const result = rows => ({ rows, rowCount: rows.length });
  return {
    sessions, registrations, courses,
    async query(sql, values = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      if (query.startsWith('SELECT id, usuario, senha_hash')) return result(values[0] === admin.usuario ? [admin] : []);
      if (query.startsWith('DELETE FROM public.sessoes_admin WHERE expira_em')) {
        for (const [token, session] of sessions) if (session.expira_em <= new Date()) sessions.delete(token);
        return result([]);
      }
      if (query.startsWith('INSERT INTO public.sessoes_admin')) {
        sessions.set(values[0], { administrador_id: values[1], expira_em: values[2] });
        return result([]);
      }
      if (query.startsWith('DELETE FROM public.sessoes_admin WHERE token_hash')) {
        sessions.delete(values[0]);
        return result([]);
      }
      if (query.startsWith('SELECT a.id, a.usuario FROM public.sessoes_admin')) {
        const session = sessions.get(values[0]);
        return result(session && session.expira_em > new Date() && session.administrador_id === admin.id
          ? [{ id: admin.id, usuario: admin.usuario }] : []);
      }
      if (query.startsWith('SELECT id, nome, data, capacidade FROM public.minicursos')) return result(courses);
      if (query.startsWith('SELECT id, nome, telefone, curso, criado_em FROM public.inscricoes')) return result(registrations);
      throw new Error(`Query inesperada no teste: ${query}`);
    },
  };
}

test('login cria sessão protegida, permite consultar os dados e logout revoga o acesso', async (t) => {
  const pool = await adminPool();
  const request = await startApp(t, { pool, secureCookies: true });
  const invalidLogin = await request('/api/admin/login', post({ usuario: 'admin', senha: 'senha-incorreta' }));
  assert.equal(invalidLogin.status, 401);
  assert.equal(pool.sessions.size, 0);

  const login = await request('/api/admin/login', post({ usuario: 'admin', senha: 'admin000' }));
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { sucesso: true });
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /minicursos_admin=[a-f0-9]{64};/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /Path=\/api\/admin/);
  const cookie = setCookie.split(';')[0];
  const token = cookie.split('=')[1];
  assert.equal(pool.sessions.has(token), false);
  assert.equal(pool.sessions.has(hashToken(token)), true);

  const session = await request('/api/admin/session', { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { autenticado: true, usuario: 'admin' });
  assert.equal(session.headers.get('cache-control'), 'no-store');

  const response = await request('/api/admin/inscricoes', { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 2);
  assert.deepEqual(body.inscricoes, pool.registrations);
  assert.deepEqual(body.cursos.map(({ id, inscritos }) => ({ id, inscritos })), [
    { id: 'sites-ia', inscritos: 2 }, { id: 'impressao-3d', inscritos: 0 },
  ]);

  const logout = await request('/api/admin/logout', post({}, { headers: { cookie } }));
  assert.equal(logout.status, 200);
  assert.equal((await logout.json()).sucesso, true);
  assert.match(logout.headers.get('set-cookie'), /minicursos_admin=;/);
  assert.equal(pool.sessions.size, 0);
  assert.equal((await request('/api/admin/session', { headers: { cookie } })).status, 401);
  assert.equal((await request('/api/admin/inscricoes', { headers: { cookie } })).status, 401);
});

test('sessão expirada ou token desconhecido não dá acesso às inscrições', async (t) => {
  const pool = await adminPool();
  const request = await startApp(t, { pool });
  const token = 'a'.repeat(64);
  pool.sessions.set(hashToken(token), { administrador_id: 1, expira_em: new Date(Date.now() - 1000) });
  for (const rawToken of [token, 'b'.repeat(64), 'invalido']) {
    const response = await request('/api/admin/inscricoes', { headers: { cookie: `minicursos_admin=${rawToken}` } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).sucesso, false);
  }
});

test('login novamente substitui a sessão anterior do navegador', async (t) => {
  const pool = await adminPool();
  const request = await startApp(t, { pool });
  const firstLogin = await request('/api/admin/login', post({ usuario: 'admin', senha: 'admin000' }));
  const oldCookie = firstLogin.headers.get('set-cookie').split(';')[0];
  const secondLogin = await request('/api/admin/login', post({ usuario: 'admin', senha: 'admin000' }, { headers: { cookie: oldCookie } }));
  assert.equal(secondLogin.status, 200);
  const newCookie = secondLogin.headers.get('set-cookie').split(';')[0];
  assert.notEqual(newCookie, oldCookie);
  assert.equal(pool.sessions.size, 1);
  assert.equal((await request('/api/admin/session', { headers: { cookie: oldCookie } })).status, 401);
  assert.equal((await request('/api/admin/session', { headers: { cookie: newCookie } })).status, 200);
});

test('corpos inválidos e tentativas de login excessivas retornam erros JSON', async (t) => {
  const request = await startApp(t, { pool: { query: async () => ({ rows: [] }) }, loginLimit: 2 });
  const invalidJson = await request('/api/inscricoes', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{' });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).sucesso, false);
  const tooLarge = await request('/api/inscricoes', post({ nome: 'a'.repeat(9000) }));
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).sucesso, false);
  const formPost = await request('/api/inscricoes', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: 'nome=Maria' });
  assert.equal(formPost.status, 415);
  for (const status of [401, 401, 429]) {
    const response = await request('/api/admin/login', post({ usuario: 'admin', senha: 'incorreta' }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).sucesso, false);
  }
});
