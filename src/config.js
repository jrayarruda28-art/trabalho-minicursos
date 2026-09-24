function configurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Aceita também valores copiados de uma linha do .env, sem alterar a credencial.
export function environmentValue(value, name) {
  let text = typeof value === 'string' ? value.trim() : '';
  if (text.startsWith(name + '=')) text = text.slice(name.length + 1).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1).trim();
  return text;
}

export function databaseUrl(value) {
  const text = environmentValue(value, 'DATABASE_URL');
  if (!text) throw configurationError('DATABASE_URL_MISSING', 'Configure DATABASE_URL no ambiente do servidor.');
  let url;
  try { url = new URL(text); } catch {
    throw configurationError('DATABASE_URL_INVALID', 'DATABASE_URL deve ser uma URL PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw configurationError('DATABASE_URL_INVALID', 'DATABASE_URL deve usar postgres:// ou postgresql://.');
  }
  return url;
}

export function applicationOrigin(value) {
  const text = environmentValue(value, 'APP_ORIGIN');
  if (!text) return undefined;
  let url;
  try { url = new URL(text); } catch {
    throw configurationError('APP_ORIGIN_INVALID', 'APP_ORIGIN deve conter a origem completa com https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw configurationError('APP_ORIGIN_INVALID', 'APP_ORIGIN deve conter somente protocolo e domínio.');
  }
  return url.origin;
}
