import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, hashToken, newToken, sessionToken } from './security.js';
import { HttpError, validarInscricao } from './validation.js';
import { registrarInscricao } from './registrations.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dummyHash = hashPassword(newToken());
const sessionDuration = 8 * 60 * 60 * 1000;

export function createApp({ pool, registrationLimit = 60, loginLimit = 10, appOrigin = process.env.APP_ORIGIN,
  trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  secureCookies = process.env.NODE_ENV === 'production' || appOrigin?.startsWith('https://') } = {}) {
  if (!pool) throw new Error('A conexão com o banco é obrigatória.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: Boolean(secureCookies), path: '/api/admin' };

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    if (secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const expectedOrigin = appOrigin ? new URL(appOrigin).origin : `${req.protocol}://${req.get('host')}`;
      if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== expectedOrigin)) {
        return next(new HttpError(403, 'Solicitação de origem não permitida.'));
      }
      if (req.path !== '/admin/logout' && !req.is('application/json')) {
        return next(new HttpError(415, 'Envie os dados no formato JSON.'));
      }
    }
    next();
  });

  const limitOptions = { windowMs: 15 * 60 * 1000, standardHeaders: 'draft-8', legacyHeaders: false };
  const registrationLimiter = rateLimit({ ...limitOptions, limit: registrationLimit,
    message: { sucesso: false, mensagem: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' } });
  const loginLimiter = rateLimit({ ...limitOptions, limit: loginLimit, skipSuccessfulRequests: true,
    message: { sucesso: false, mensagem: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.' } });
  const json = express.json({ limit: '8kb' });

  app.post('/api/inscricoes', registrationLimiter, json, async (req, res) => {
    const dados = validarInscricao(req.body);
    const inscricao = await registrarInscricao(pool, dados);
    res.status(201).json({ sucesso: true, id: inscricao.id });
  });

  app.post('/api/admin/login', loginLimiter, json, async (req, res) => {
    const { usuario, senha } = req.body || {};
    if (typeof usuario !== 'string' || typeof senha !== 'string' || usuario.length > 80 || senha.length > 200 || !usuario.trim() || !senha) {
      throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    const result = await pool.query('SELECT id, usuario, senha_hash FROM public.administradores WHERE usuario = $1', [usuario.trim()]);
    const admin = result.rows[0];
    const valid = await verifyPassword(senha, admin?.senha_hash || await dummyHash);
    if (!admin || !valid) throw new HttpError(401, 'Usuário ou senha incorretos.');
    const token = newToken();
    const expires = new Date(Date.now() + sessionDuration);
    await pool.query('DELETE FROM public.sessoes_admin WHERE expira_em <= now()');
    await pool.query('INSERT INTO public.sessoes_admin (token_hash, administrador_id, expira_em) VALUES ($1, $2, $3)', [hashToken(token), admin.id, expires]);
    const previousToken = sessionToken(req);
    if (previousToken) await pool.query('DELETE FROM public.sessoes_admin WHERE token_hash = $1', [hashToken(previousToken)]);
    res.cookie('minicursos_admin', token, { ...cookieOptions, maxAge: sessionDuration });
    res.json({ sucesso: true });
  });

  async function authenticated(req, res, next) {
    const token = sessionToken(req);
    if (!token) throw new HttpError(401, 'Entre na área administrativa para continuar.');
    const result = await pool.query(`SELECT a.id, a.usuario FROM public.sessoes_admin s
      JOIN public.administradores a ON a.id = s.administrador_id
      WHERE s.token_hash = $1 AND s.expira_em > now()`, [hashToken(token)]);
    if (!result.rowCount) {
      res.clearCookie('minicursos_admin', cookieOptions);
      throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
    }
    req.admin = result.rows[0];
    next();
  }

  app.get('/api/admin/session', authenticated, (req, res) => res.json({ autenticado: true, usuario: req.admin.usuario }));

  app.get('/api/admin/inscricoes', authenticated, async (req, res) => {
    const [courses, registrations] = await Promise.all([
      pool.query('SELECT id, nome, data, capacidade FROM public.minicursos ORDER BY ordem'),
      pool.query('SELECT id, nome, telefone, curso, criado_em FROM public.inscricoes ORDER BY criado_em DESC, id DESC'),
    ]);
    const inscritos = new Map();
    for (const registration of registrations.rows) inscritos.set(registration.curso, (inscritos.get(registration.curso) || 0) + 1);
    res.json({ cursos: courses.rows.map(course => ({ ...course, inscritos: inscritos.get(course.id) || 0 })),
      inscricoes: registrations.rows, total: registrations.rowCount });
  });

  app.post('/api/admin/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await pool.query('DELETE FROM public.sessoes_admin WHERE token_hash = $1', [hashToken(token)]);
    res.clearCookie('minicursos_admin', cookieOptions);
    res.json({ sucesso: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ sucesso: false, mensagem: 'Página não encontrada.' }));
  app.get(['/', '/index.html'], (req, res) => res.sendFile('index.html', { root }));
  app.get(['/admin', '/admin/', '/admin.html'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile('public/admin.html', { root });
  });
  // A raiz do projeto, .env, migrações e código do servidor nunca são publicados.
  app.use('/assets', express.static(root + 'public', { dotfiles: 'deny', index: false }));
  app.use((req, res) => res.status(404).type('text').send('Página não encontrada.'));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ sucesso: false, mensagem: 'Os dados enviados não são um JSON válido.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ sucesso: false, mensagem: 'Os dados enviados excedem o tamanho permitido.' });
    if (error instanceof HttpError) return res.status(error.status).json({ sucesso: false, mensagem: error.message, ...(error.codigo && { codigo: error.codigo }) });
    console.error('Falha ao processar solicitação.', /^[A-Z0-9_]{2,40}$/.test(error.code || '') ? error.code : 'INTERNAL_ERROR');
    res.status(503).json({ sucesso: false, mensagem: 'O serviço está temporariamente indisponível. Tente novamente em instantes.' });
  });
  return app;
}
