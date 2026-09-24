import assert from 'node:assert/strict';
import test from 'node:test';
import { validarInscricao } from '../src/validation.js';

const dadosValidos = {
  nome: 'Maria da Silva',
  telefone: '+5581999991234',
  curso: 'sites-ia',
};

test('aceita os quatro minicursos e preserva nomes acentuados', () => {
  for (const curso of ['sites-ia', 'impressao-3d', 'corte-laser', 'ecommerce']) {
    assert.deepEqual(validarInscricao({ ...dadosValidos, nome: 'João Gonçalves', curso }), {
      nome: 'João Gonçalves', telefone: '+5581999991234', curso,
    });
  }
});

test('normaliza espaços do nome e telefones brasileiros antes de salvar', () => {
  for (const telefone of ['(81) 99999-1234', '81999991234', '+55 (81) 99999-1234']) {
    assert.deepEqual(validarInscricao({ ...dadosValidos, nome: '  Maria   da Silva  ', telefone }), dadosValidos);
  }
  assert.equal(validarInscricao({ ...dadosValidos, telefone: '(81) 3333-1234' }).telefone, '+558133331234');
});

test('rejeita dados ausentes, tipos inesperados e valores fora dos limites com status 400', () => {
  const invalidos = [
    null, undefined, [], '', 42, {},
    { ...dadosValidos, nome: 'Maria' },
    { ...dadosValidos, nome: 'A ' + 'b'.repeat(120) },
    { ...dadosValidos, nome: ['Maria', 'Silva'] },
    { ...dadosValidos, telefone: 81999991234 },
    { ...dadosValidos, telefone: '819999' },
    { ...dadosValidos, telefone: '01999991234' },
    { ...dadosValidos, telefone: '81899991234' },
    { ...dadosValidos, telefone: '81abc999991234' },
    { ...dadosValidos, telefone: '+1 (212) 555-1234' },
    { ...dadosValidos, curso: '' },
    { ...dadosValidos, curso: 'curso-inexistente' },
    { ...dadosValidos, curso: '__proto__' },
    { ...dadosValidos, curso: ['sites-ia'] },
  ];
  for (const dados of invalidos) {
    assert.throws(() => validarInscricao(dados), { status: 400 }, `deveria rejeitar ${JSON.stringify(dados)}`);
  }
});

test('descarta campos extras enviados pelo cliente', () => {
  assert.deepEqual(validarInscricao({ ...dadosValidos, id: 5, admin: true, criado_em: 'ontem' }), dadosValidos);
});
