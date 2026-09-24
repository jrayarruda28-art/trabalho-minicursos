import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    const error = new Error('Configure DATABASE_URL nas variáveis de ambiente do servidor.');
    error.code = 'DATABASE_URL_MISSING';
    throw error;
  }
  const url = new URL(connectionString);
  // TLS é configurado aqui para que parâmetros da URL não desativem a verificação.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'pgbouncer']) url.searchParams.delete(key);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const ca = [...rootCertificates];
  if (url.hostname.endsWith('.supabase.com')) {
    ca.push(readFileSync(new URL('../certs/supabase-ca.crt', import.meta.url), 'utf8'));
  }
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true, ca },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: 'minicursos-ete',
  });
  // Não registrar URLs, credenciais nem informações pessoais em erros.
  pool.on('error', () => console.error('Uma conexão inativa com o banco foi encerrada.'));
  return pool;
}

// Uma instância por processo, criada somente quando uma rota precisa do banco.
// Assim, importar a função na Vercel não depende de conexão ou do arquivo .env.
export function createLazyPool(factory = createPool) {
  let pool;
  const getPool = () => pool ||= factory();
  return {
    query: async (...args) => getPool().query(...args),
    connect: async () => getPool().connect(),
    end: async () => {
      if (pool) {
        await pool.end();
        pool = undefined;
      }
    },
  };
}
