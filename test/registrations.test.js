import assert from 'node:assert/strict';
import test from 'node:test';
import { registrarInscricao } from '../src/registrations.js';

const dados = { nome: "Ana D'Ávila", telefone: '+5581999991234', curso: 'sites-ia' };

test('aguarda a gravação no banco e envia os dados como parâmetros separados', async () => {
  const inscription = { id: '42', ...dados, criado_em: new Date('2026-09-23T12:00:00Z') };
  const commands = [];
  let finishQuery;
  let completed = false;
  const pool = {
    query(sql, values) {
      commands.push({ sql, values });
      return new Promise(resolve => { finishQuery = resolve; });
    },
  };
  const pending = registrarInscricao(pool, dados).then(result => {
    completed = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(completed, false, 'não pode confirmar a inscrição antes de o banco responder');
  assert.equal(commands.length, 1);
  assert.match(commands[0].sql, /public\.registrar_inscricao\(\$1,\s*\$2,\s*\$3\)/);
  assert.equal(commands[0].sql.includes(dados.nome), false);
  assert.deepEqual(commands[0].values, [dados.nome, dados.telefone, dados.curso]);
  finishQuery({ rows: [inscription], rowCount: 1 });
  assert.deepEqual(await pending, inscription);
});

test('restrição única no banco vira erro de inscrição duplicada', async () => {
  const pool = { query: async () => { throw Object.assign(new Error('unique constraint'), { code: '23505' }); } };
  await assert.rejects(registrarInscricao(pool, dados), { status: 409, codigo: 'INSCRICAO_DUPLICADA' });
});

test('curso ausente no banco é rejeitado como dados inválidos', async () => {
  const pool = { query: async () => { throw Object.assign(new Error('course missing'), { code: 'P0002' }); } };
  await assert.rejects(registrarInscricao(pool, dados), { status: 400 });
});

test('falhas de conexão e erros desconhecidos nunca retornam sucesso', async () => {
  for (const code of ['08006', '40001', '57014', undefined]) {
    const databaseError = Object.assign(new Error('database operation failed'), { code });
    const pool = { query: async () => { throw databaseError; } };
    await assert.rejects(registrarInscricao(pool, dados), error => error === databaseError);
  }
});
