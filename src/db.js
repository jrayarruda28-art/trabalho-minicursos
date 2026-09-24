import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import pg from 'pg';

export function parseDatabaseUrl(value) {
  let connectionString = value ?? '';
  if (typeof connectionString === 'string') {
    connectionString = connectionString.trim();
    // Aceitar uma linha do .env colada no campo de valor da hospedagem.
    if (connectionString.startsWith('DATABASE_URL=')) connectionString = connectionString.slice('DATABASE_URL='.length).trim();
    const quote = connectionString[0];
    if (connectionString.length >= 2 && (quote === '"' || quote === "'") && connectionString.endsWith(quote)) {
      connectionString = connectionString.slice(1, -1).trim();
    }
  }
  if (connectionString === '') {
    const error = new Error('Configure DATABASE_URL nas variáveis de ambiente do servidor.');
    error.code = 'DATABASE_URL_MISSING';
    throw error;
  }
  try {
    if (typeof connectionString !== 'string' || /[\u0000-\u001f\u007f]/.test(connectionString)) throw new Error();
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error();
    return url;
  } catch {
    // O erro nativo de URL contém o valor recebido, incluindo a senha.
    const error = new Error('DATABASE_URL inválida. Use a URL de conexão PostgreSQL no formato postgresql://usuario:senha@host:porta/banco.');
    error.code = 'DATABASE_URL_INVALID';
    throw error;
  }
}

export function createPool(connectionString = process.env.DATABASE_URL) {
  const url = parseDatabaseUrl(connectionString);
  // TLS é configurado aqui para que parâmetros da URL não desativem a verificação.
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'pgbouncer']) url.searchParams.delete(key);
  const hostname = (url.searchParams.getAll('host').at(-1) || url.hostname).toLowerCase();
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  const ca = [...rootCertificates];
  if (hostname.endsWith('.supabase.com')) {
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
