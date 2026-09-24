import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseUrl, applicationOrigin } from '../src/config.js';

test('URLs copiadas do .env aceitam prefixo, aspas e espaços externos', () => {
  const expected = 'postgresql://admin:senha%40teste@database.example:6543/postgres';
  for (const value of [expected, `  "${expected}"  `, `DATABASE_URL='${expected}'`]) assert.equal(databaseUrl(value).href, expected);
  assert.equal(applicationOrigin('APP_ORIGIN="https://trabalho-minicursos.vercel.app/"'), 'https://trabalho-minicursos.vercel.app');
  assert.equal(applicationOrigin(''), undefined);
});

test('configuração inválida identifica a variável sem expor o conteúdo', () => {
  for (const value of ['senha-confidencial', 'https://database.example']) {
    assert.throws(() => databaseUrl(value), error => error.code === 'DATABASE_URL_INVALID' && !error.message.includes(value));
  }
  assert.throws(() => databaseUrl(''), { code: 'DATABASE_URL_MISSING' });
  for (const value of ['trabalho-minicursos.vercel.app', 'https://site.example/admin', 'https://user:password@site.example']) {
    assert.throws(() => applicationOrigin(value), { code: 'APP_ORIGIN_INVALID' });
  }
});
