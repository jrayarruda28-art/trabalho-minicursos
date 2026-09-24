import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import test from 'node:test';
import pg from 'pg';
import { createPool, parseDatabaseUrl } from '../src/db.js';

const connectionString = 'postgresql://usuario:senha%40segura@db.example.test:6543/postgres';

test('URL do banco aceita os formatos comuns ao copiar a variável de ambiente', () => {
  for (const value of [
    connectionString,
    ` \n${connectionString}\r\n`,
    `"${connectionString}"`,
    `'${connectionString}'`,
    `DATABASE_URL=${connectionString}`,
    ` DATABASE_URL="${connectionString}" \n`,
    `DATABASE_URL='${connectionString}'`,
  ]) {
    const url = parseDatabaseUrl(value);
    assert.ok(url instanceof URL);
    assert.equal(url.href, connectionString);
  }
  assert.equal(parseDatabaseUrl(connectionString.replace('postgresql:', 'postgres:')).protocol, 'postgres:');
});

test('URL ausente ou vazia gera diagnóstico específico sem dados de entrada', () => {
  for (const value of [undefined, null, '', ' \r\n ', 'DATABASE_URL=', 'DATABASE_URL=""', "DATABASE_URL='  '", '""', "''"]) {
    assert.throws(() => parseDatabaseUrl(value), error => {
      assert.equal(error.code, 'DATABASE_URL_MISSING');
      assert.equal(error.input, undefined);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('URL malformada, protocolo incorreto e controles internos são rejeitados sem expor credenciais', () => {
  const invalidValues = [
    'valor-invalido-segredo',
    'https://usuario:segredo@db.example.test/postgres',
    'usuario:segredo@db.example.test:6543/postgres',
    'postgresql:///postgres',
    'postgresql://usuario:segredo@[invalid/postgres',
    'postgresql://usuario:segredo@db.example.test:porta/postgres',
    'postgresql://usuario:segredo@db.example.test/postgres#fragmento',
    'postgresql://usuario:segredo@db.exam\nple.test/postgres',
    'postgresql://usuario:seg\tre do@db.example.test/postgres',
    'postgresql://usuario:segredo@db.example.test/postgres\u0000',
    `OUTRA_VARIAVEL=${connectionString}`,
    `"${connectionString}'`,
    42,
    {},
  ];
  const errors = invalidValues.map(value => {
    let caught;
    assert.throws(() => parseDatabaseUrl(value), error => {
      caught = error;
      assert.equal(error.code, 'DATABASE_URL_INVALID');
      assert.equal(error.input, undefined);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(`${error.message} ${error.stack} ${JSON.stringify(error)}`, /segredo|senha%40segura|db\.example\.test/);
      return true;
    });
    return caught;
  });
  assert.equal(new Set(errors.map(error => error.message)).size, 1, 'a mensagem não incorpora o valor rejeitado');
});

test('normalização preserva credenciais codificadas e sua interpretação pelo driver', async (t) => {
  const password = ' espaço "interno" @:/?#%+\\ fim ';
  const username = 'usuario@projeto';
  const value = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@db.example.test:6543/postgres?application_name=teste%20de%20login`;
  const url = parseDatabaseUrl(`DATABASE_URL='${value}'`);
  assert.equal(url.username, encodeURIComponent(username));
  assert.equal(url.password, encodeURIComponent(password));
  assert.equal(url.searchParams.get('application_name'), 'teste de login');
  const pool = createPool(`DATABASE_URL="${value}"`);
  t.after(() => pool.end());
  const client = new pg.Client(pool.options);
  assert.equal(client.connectionParameters.user, username);
  assert.equal(client.connectionParameters.password, password);
  assert.equal(client.connectionParameters.host, 'db.example.test');
  assert.equal(client.connectionParameters.port, 6543);
  assert.equal(pool.totalCount, 0, 'inspecionar as opções não deve abrir conexões');
});

test('parâmetros da URL não desativam TLS nem a verificação do certificado remoto', async (t) => {
  for (const query of [
    '',
    'ssl=0',
    'ssl=no-verify',
    'sslmode=disable',
    'sslmode=no-verify',
    'ssl=0&ssl=no-verify&sslmode=disable&sslmode=no-verify&sslcert=/arquivo-inexistente&sslkey=/arquivo-inexistente&sslrootcert=/arquivo-inexistente&pgbouncer=true',
  ]) {
    const pool = createPool(`${connectionString}${query ? `?${query}` : ''}`);
    t.after(() => pool.end());
    const client = new pg.Client(pool.options);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true, query);
    assert.deepEqual(client.connectionParameters.ssl.ca, rootCertificates, query);
    assert.equal(client.connectionParameters.host, 'db.example.test', query);
    assert.equal(pool.totalCount, 0);
  }
});

test('conexões locais continuam sem TLS e Supabase recebe a CA adicional', async (t) => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const pool = createPool(`postgresql://usuario:senha@${hostname}:5432/postgres?ssl=1&sslmode=require`);
    t.after(() => pool.end());
    const client = new pg.Client(pool.options);
    assert.equal(client.connectionParameters.ssl, false, hostname);
    assert.equal(pool.totalCount, 0);
  }
  const pool = createPool('postgresql://usuario:senha@db.projeto.supabase.com:5432/postgres');
  t.after(() => pool.end());
  const client = new pg.Client(pool.options);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.ca.length, rootCertificates.length + 1);
  assert.match(client.connectionParameters.ssl.ca.at(-1), /BEGIN CERTIFICATE/);
  assert.equal(pool.totalCount, 0);
});


test('TLS considera o host remoto efetivamente utilizado pelo driver', async (t) => {
  for (const query of [
    'host=db.example.test',
    'host=localhost&host=db.example.test',
  ]) {
    const pool = createPool(`postgresql://usuario:senha@localhost:5432/postgres?${query}`);
    t.after(() => pool.end());
    const client = new pg.Client(pool.options);
    assert.equal(client.connectionParameters.host, 'db.example.test', query);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true, query);
    assert.equal(pool.totalCount, 0);
  }
});
