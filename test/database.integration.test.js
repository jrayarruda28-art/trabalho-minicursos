import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createPool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { registrarInscricao } from '../src/registrations.js';

test('PostgreSQL real: aceita mais de 25 inscrições, persiste dados e protege sessão', { skip: process.env.RUN_DB_TESTS !== '1', timeout: 90000 }, async () => {
  const raw = createPool();
  // Cada execução cria e remove apenas seu próprio schema, sem alterar dados reais.
  const schema = 'minicursos_test_' + randomBytes(8).toString('hex');
  const sqlForTest = sql => sql.replaceAll('public.', `${schema}.`);
  const pool = {
    query: (sql, values) => raw.query(sqlForTest(sql), values),
    connect: async () => {
      const client = await raw.connect();
      return { query: (sql, values) => client.query(sqlForTest(sql), values), release: () => client.release() };
    },
  };
  let server;
  try {
    await raw.query(`CREATE SCHEMA ${schema}`);
    const migration = await readFile(new URL('../migrations/001_inscricoes.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    // Aplicar novamente deve preservar as tabelas e os quatro cursos.
    await pool.query(migration);
    const courses = await pool.query('SELECT id FROM public.minicursos');
    assert.equal(courses.rowCount, 4);

    const entries = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => registrarInscricao(pool, {
      nome: 'Participante Teste', telefone: '+55819' + String(index).padStart(8, '0'), curso: 'sites-ia',
    })));
    assert.equal(entries.filter(result => result.status === 'fulfilled').length, 32, JSON.stringify(entries.filter(result => result.status === 'rejected').map(result => ({ codigo: result.reason.codigo, code: result.reason.code, message: result.reason.message }))));
    assert.equal((await pool.query("SELECT COUNT(*)::int AS total FROM public.inscricoes WHERE curso = 'sites-ia'")).rows[0].total, 32);

    const duplicateData = { nome: 'Pessoa Teste', telefone: '+5581999990000', curso: 'impressao-3d' };
    const duplicateResults = await Promise.allSettled(Array.from({ length: 8 }, () => registrarInscricao(pool, duplicateData)));
    assert.equal(duplicateResults.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of duplicateResults.filter(result => result.status === 'rejected')) assert.equal(result.reason.codigo, 'INSCRICAO_DUPLICADA');
    await registrarInscricao(pool, { ...duplicateData, curso: 'corte-laser' });

    const rls = await raw.query('SELECT relrowsecurity FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = $2', [schema, 'r']);
    assert.equal(rls.rows.length, 4);
    assert.ok(rls.rows.every(row => row.relrowsecurity));
    const publicRoles = await raw.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')");
    for (const { rolname } of publicRoles.rows) {
      const privileges = await raw.query('SELECT has_table_privilege($1, $2, $3) AS allowed', [rolname, `${schema}.inscricoes`, 'SELECT']);
      assert.equal(privileges.rows[0].allowed, false);
      const execute = await raw.query('SELECT has_function_privilege($1, $2, $3) AS allowed', [rolname, `${schema}.registrar_inscricao(text,text,text)`, 'EXECUTE']);
      assert.equal(execute.rows[0].allowed, false);
    }

    const password = randomBytes(16).toString('hex');
    await pool.query('INSERT INTO public.administradores (usuario, senha_hash) VALUES ($1, $2)', ['admin_teste', await hashPassword(password)]);
    server = createApp({ pool, secureCookies: false, appOrigin: '', trustProxy: false }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/api/admin/inscricoes')).status, 401);
    assert.equal((await send('/api/admin/login', { usuario: 'admin_teste', senha: 'incorreta' })).status, 401);
    const login = await send('/api/admin/login', { usuario: 'admin_teste', senha: password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);

    const response = await send('/api/inscricoes', { nome: 'Cadastro Teste Final', telefone: '(81) 98888-1234', curso: 'ecommerce' });
    assert.equal(response.status, 201);
    const saved = await response.json();
    const persisted = await pool.query('SELECT nome, telefone, curso FROM public.inscricoes WHERE id = $1', [saved.id]);
    assert.deepEqual(persisted.rows[0], { nome: 'Cadastro Teste Final', telefone: '+5581988881234', curso: 'ecommerce' });
    const adminList = await fetch(base + '/api/admin/inscricoes', { headers: { Cookie: cookie } });
    const data = await adminList.json();
    assert.equal(adminList.status, 200);
    assert.equal(data.total, 35);
    assert.equal(data.cursos.find(course => course.id === 'sites-ia').inscritos, 32);
    assert.equal(data.cursos.find(course => course.id === 'sites-ia').capacidade, 25);
    assert.equal(data.cursos.length, 4, 'todos os cursos continuam disponíveis após ultrapassar 25 inscritos');
    assert.ok(data.inscricoes.some(entry => entry.id === saved.id));
    assert.equal((await send('/api/admin/logout', {}, cookie)).status, 200);
    assert.equal((await fetch(base + '/api/admin/inscricoes', { headers: { Cookie: cookie } })).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await raw.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await raw.end();
  }
});
