import { createPool } from '../src/db.js';
import { hashPassword } from '../src/security.js';

const usuario = (process.env.ADMIN_USERNAME || 'admin').trim();
const senha = process.env.ADMIN_PASSWORD;
if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(usuario) || !senha || senha.length < 8 || senha.length > 200) {
  console.error('Defina ADMIN_USERNAME e ADMIN_PASSWORD (8 a 200 caracteres) no .env antes de configurar o administrador.');
  process.exit(1);
}
const pool = createPool();
let client;
try {
  client = await pool.connect();
  const hash = await hashPassword(senha);
  await client.query('BEGIN');
  const { rows } = await client.query('INSERT INTO public.administradores (usuario, senha_hash) VALUES ($1, $2) ON CONFLICT (usuario) DO UPDATE SET senha_hash = EXCLUDED.senha_hash RETURNING id', [usuario, hash]);
  await client.query('DELETE FROM public.sessoes_admin WHERE administrador_id = $1', [rows[0].id]);
  await client.query('COMMIT');
  console.log('Administrador configurado. As sessões anteriores foram encerradas.');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Não foi possível configurar o administrador.', error.code || '');
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
