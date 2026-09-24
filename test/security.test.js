import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword, hashToken } from '../src/security.js';

test('senha é armazenada com salt e aceita apenas a senha correta', async () => {
  const primeiro = await hashPassword('admin000');
  const segundo = await hashPassword('admin000');
  assert.notEqual(primeiro, 'admin000');
  assert.notEqual(primeiro, segundo);
  assert.equal(await verifyPassword('admin000', primeiro), true);
  assert.equal(await verifyPassword('senha errada', primeiro), false);
});

test('hashes de senha inválidos nunca autenticam', async () => {
  for (const hash of ['', 'admin000', 'scrypt:invalid:invalid', null]) {
    assert.equal(await verifyPassword('admin000', hash), false);
  }
});

test('o hash do token é determinístico e não armazena o token original', () => {
  const token = 'token-de-sessao-aleatorio-0123456789';
  const hash = hashToken(token);
  assert.equal(hashToken(token), hash);
  assert.notEqual(hashToken(token + '-outro'), hash);
  assert.notEqual(hash, token);
});
