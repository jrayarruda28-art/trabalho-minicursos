import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.js';

const pool = createPool();
try {
  const sql = await readFile(new URL('../migrations/001_inscricoes.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Banco configurado: minicursos, inscricoes, administradores e sessoes_admin.');
} catch (error) {
  console.error('Não foi possível preparar o banco. Confira a conexão e as permissões.', error.code || '');
  process.exitCode = 1;
} finally {
  await pool.end();
}
