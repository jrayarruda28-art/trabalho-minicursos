import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const [adminHtml, adminScript, registrationHtml, registrationScript] = await Promise.all([
  readFile(new URL('../public/admin.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/registration.js', import.meta.url), 'utf8'),
]);
const courses = [
  { id: 'sites-ia', nome: 'Desenvolvimento de sites com IA', data: '29/09', capacidade: 25 },
  { id: 'impressao-3d', nome: 'Modelagem e impressão 3D', data: '29/10', capacidade: 25 },
  { id: 'corte-laser', nome: 'Corte a laser', data: '24/11', capacidade: 25 },
  { id: 'ecommerce', nome: 'E-commerce', data: '10 a 13/12', capacidade: 25 },
];
const registrations = [
  { id: '1', nome: 'João da Silva', telefone: '+5581999991234', curso: 'sites-ia', criado_em: '2026-09-23T12:30:00.000Z' },
  { id: '2', nome: 'Ana de Souza', telefone: '+5581988884321', curso: 'impressao-3d', criado_em: '2026-09-22T12:30:00.000Z' },
  { id: '3', nome: '<img src=x onerror=alert(1)>', telefone: '+5581977771234', curso: 'corte-laser', criado_em: '2026-09-21T12:30:00.000Z' },
];
const catalog = { cursos: courses, inscricoes: registrations, total: registrations.length };
const ok = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(payload) });
const flush = async () => { await nextTurn(); await nextTurn(); };

function browser(t, kind, handler) {
  // Ignore embedded fonts and artwork: these tests inspect behavior, not rendering.
  const html = (kind === 'admin' ? adminHtml : registrationHtml).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const dom = new JSDOM(html, { url: `https://minicursos.test/${kind === 'admin' ? 'admin' : ''}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.matchMedia = () => ({ matches: false });
  // jsdom has no dialog UI; keep the browser's open/close contract and close event.
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.fetch = async (path, options) => { calls.push({ path, options }); return handler(path, options); };
  t.after(() => window.close());
  const byId = (id) => window.document.getElementById(id);
  const input = (id, value, event = 'input') => { byId(id).value = value; byId(id).dispatchEvent(new window.Event(event, { bubbles: true })); };
  const submit = (id) => byId(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  window.eval(kind === 'admin' ? adminScript : registrationScript);
  return { window, document: window.document, byId, input, submit, calls };
}

test('admin: login, cursos, busca, detalhes seguros e logout removem os dados', async (t) => {
  const ui = browser(t, 'admin', (path) => {
    if (path.endsWith('/session')) return ok({ mensagem: 'Acesso restrito.' }, 401);
    if (path.endsWith('/login') || path.endsWith('/logout')) return ok({ sucesso: true });
    if (path.endsWith('/inscricoes')) return ok(catalog);
    throw new Error(`Rota inesperada: ${path}`);
  });
  await flush();
  assert.equal(ui.byId('login-view').hidden, false);
  assert.equal(ui.document.activeElement.id, 'usuario');
  ui.input('usuario', 'admin');
  ui.input('senha', 'senha-de-teste');
  ui.submit('login-form');
  await flush();
  assert.equal(ui.byId('dashboard').hidden, false);
  assert.equal(ui.byId('login-view').hidden, true);
  assert.equal(ui.byId('senha').value, '');
  assert.equal(ui.byId('total-count').textContent, '3');
  assert.equal(ui.document.querySelectorAll('.course-card').length, 4);
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 3);
  const login = ui.calls.find((call) => call.path.endsWith('/login'));
  assert.deepEqual(JSON.parse(login.options.body), { usuario: 'admin', senha: 'senha-de-teste' });
  assert.equal(login.options.credentials, 'same-origin');
  assert.equal(login.options.headers['Content-Type'], 'application/json');

  ui.document.querySelector('[data-course="sites-ia"]').click();
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 1);
  assert.equal(ui.byId('course-filter').value, 'sites-ia');
  assert.equal(ui.document.querySelector('[data-course="sites-ia"]').getAttribute('aria-pressed'), 'true');
  ui.input('search', 'joao');
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 1, 'busca ignora acentos');
  ui.input('search', '(81) 99999-1234');
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 1, 'busca aceita telefone com máscara');
  ui.input('search', 'sem resultado');
  assert.equal(ui.byId('empty-state').hidden, false);
  ui.byId('clear-filters').click();
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 3);
  assert.equal(ui.document.activeElement.id, 'search');

  ui.input('course-filter', 'impressao-3d', 'change');
  const trigger = ui.document.querySelector('.registration-row');
  trigger.click();
  assert.equal(ui.byId('detail-dialog').open, true);
  assert.equal(ui.byId('detail-name').textContent, 'Ana de Souza');
  assert.equal(ui.byId('detail-phone').textContent, '+5581988884321');
  assert.equal(ui.byId('detail-phone').firstChild.href, 'tel:+5581988884321');
  assert.equal(ui.byId('detail-course').textContent, 'Modelagem e impressão 3D');
  assert.equal(ui.byId('detail-course-date').textContent, '29/10');
  assert.match(ui.byId('detail-date').textContent, /22\/09\/2026/);
  assert.equal(ui.document.activeElement.id, 'close-detail');
  ui.byId('done-detail').click();
  assert.equal(ui.byId('detail-dialog').open, false);
  assert.equal(ui.document.activeElement, trigger);

  ui.input('course-filter', 'corte-laser', 'change');
  ui.document.querySelector('.registration-row').click();
  assert.equal(ui.byId('detail-name').textContent, registrations[2].nome);
  assert.equal(ui.byId('detail-name').querySelector('img'), null, 'nome não é interpretado como HTML');
  assert.equal(ui.byId('registration-list').querySelector('img'), null);
  ui.byId('done-detail').click();
  ui.byId('logout').click();
  await flush();
  assert.equal(ui.byId('login-view').hidden, false);
  assert.equal(ui.byId('dashboard').hidden, true);
  assert.equal(ui.byId('registration-list').childElementCount, 0);
  assert.equal(ui.byId('detail-name').textContent, '');
});

test('admin: atualização falha preserva a lista; sessão expirada limpa os dados e detalhes', async (t) => {
  let listStatus = 200;
  const ui = browser(t, 'admin', (path) => {
    if (path.endsWith('/session')) return ok({ autenticado: true, usuario: 'admin' });
    if (path.endsWith('/inscricoes')) return listStatus === 200 ? ok(catalog) : ok({ mensagem: listStatus === 401 ? 'Sessão expirada.' : 'Banco temporariamente indisponível.' }, listStatus);
    throw new Error(`Rota inesperada: ${path}`);
  });
  await flush();
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 3);
  listStatus = 503;
  ui.byId('refresh').click();
  await flush();
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 3);
  assert.match(ui.byId('dashboard-error').textContent, /Banco temporariamente indisponível/);
  assert.match(ui.byId('dashboard-error').textContent, /última atualização/);
  assert.equal(ui.byId('refresh').disabled, false);
  ui.document.querySelector('.registration-row').click();
  listStatus = 401;
  ui.byId('refresh').click();
  await flush();
  assert.equal(ui.byId('login-view').hidden, false);
  assert.equal(ui.byId('registration-list').childElementCount, 0);
  assert.equal(ui.byId('detail-dialog').open, false);
  assert.equal(ui.document.body.classList.contains('dialog-open'), false);
  assert.match(ui.byId('login-error').textContent, /sessão expirou/);
});

test('admin: erro de credencial permanece no login e usa a mensagem da API', async (t) => {
  const ui = browser(t, 'admin', () => ok({ mensagem: 'Usuário ou senha incorretos.' }, 401));
  await flush();
  ui.input('usuario', 'admin');
  ui.input('senha', 'senha-incorreta');
  ui.submit('login-form');
  await flush();
  assert.equal(ui.byId('dashboard').hidden, true);
  assert.equal(ui.byId('login-view').hidden, false);
  assert.equal(ui.byId('login-error').textContent, 'Usuário ou senha incorretos.');
  assert.equal(ui.document.activeElement.id, 'login-error');
  assert.equal(ui.byId('login-submit').disabled, false);
  assert.equal(ui.byId('senha').getAttribute('aria-invalid'), 'true');
});

test('admin: resposta atrasada de inscrições após logout não reexibe dados', async (t) => {
  let resolveList;
  const waitingList = new Promise((resolve) => { resolveList = resolve; });
  const ui = browser(t, 'admin', (path) => {
    if (path.endsWith('/session')) return ok({ autenticado: true });
    if (path.endsWith('/logout')) return ok({ sucesso: true });
    return waitingList;
  });
  await flush();
  ui.byId('logout').click();
  await flush();
  resolveList(ok(catalog));
  await flush();
  assert.equal(ui.byId('dashboard').hidden, true);
  assert.equal(ui.byId('registration-list').childElementCount, 0);
  assert.equal(ui.byId('total-count').textContent, '—');
});

test('formulário: envio único normaliza nome/telefone e só confirma após sucesso da API', async (t) => {
  let resolveSubmission;
  const waiting = new Promise((resolve) => { resolveSubmission = resolve; });
  const ui = browser(t, 'registration', () => waiting);
  ui.input('nome', '  João   da Silva  ');
  ui.input('telefone', '+55 (81) 99999-1234');
  ui.input('curso', 'sites-ia', 'change');
  ui.submit('registration-form');
  ui.submit('registration-form');
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].path, '/api/inscricoes');
  assert.deepEqual(JSON.parse(ui.calls[0].options.body), { nome: 'João da Silva', telefone: '+5581999991234', curso: 'sites-ia' });
  assert.equal(ui.byId('submit-button').disabled, true);
  assert.equal(ui.byId('nome').disabled, true);
  assert.equal(ui.byId('form-status').hidden, true);
  resolveSubmission(ok({ sucesso: true }, 201));
  await flush();
  assert.equal(ui.byId('form-status').dataset.state, 'success');
  assert.match(ui.byId('form-status').textContent, /Inscrição recebida em Desenvolvimento de sites com IA/);
  assert.equal(ui.byId('nome').value, '');
  assert.equal(ui.byId('telefone').value, '');
  assert.equal(ui.byId('curso').value, '');
  assert.equal(ui.byId('submit-button').disabled, false);
  assert.equal(ui.byId('nome').disabled, false);
  assert.equal(ui.document.activeElement.id, 'form-status');
});

test('formulário: erros de inscrição preservam dados e permitem nova tentativa', async (t) => {
  let response = ok({ mensagem: 'Este telefone já está inscrito neste curso.' }, 409);
  const ui = browser(t, 'registration', () => response);
  ui.input('nome', 'Ana de Souza');
  ui.input('telefone', '(81) 98888-4321');
  ui.input('curso', 'impressao-3d', 'change');
  ui.submit('registration-form');
  await flush();
  assert.equal(ui.byId('form-status').dataset.state, 'error');
  assert.equal(ui.byId('form-status').textContent, 'Este telefone já está inscrito neste curso.');
  assert.equal(ui.byId('nome').value, 'Ana de Souza');
  assert.equal(ui.byId('curso').value, 'impressao-3d');
  assert.equal(ui.byId('submit-button').disabled, false);
  ui.input('curso', 'corte-laser', 'change');
  assert.equal(ui.byId('form-status').hidden, true);
  response = ok({ sucesso: false });
  ui.submit('registration-form');
  await flush();
  assert.equal(ui.byId('form-status').dataset.state, 'error');
  assert.equal(ui.byId('nome').value, 'Ana de Souza');
  assert.match(ui.byId('form-status').textContent, /ainda não foi confirmada/);
});

test('formulário: validação impede dados incompletos e botão do curso preenche seleção', (t) => {
  const ui = browser(t, 'registration', () => { throw new Error('Dados inválidos não devem chegar à API.'); });
  ui.submit('registration-form');
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.document.activeElement.id, 'nome');
  assert.equal(ui.byId('nome').getAttribute('aria-invalid'), 'true');
  ui.document.querySelector('[data-course="ecommerce"]').click();
  assert.equal(ui.byId('curso').value, 'ecommerce');
  assert.equal(ui.document.activeElement.id, 'nome');
  ui.input('nome', 'Maria');
  ui.input('telefone', '123');
  ui.submit('registration-form');
  assert.equal(ui.calls.length, 0);
  assert.match(ui.byId('nome-error').textContent, /nome e sobrenome/);
  assert.match(ui.byId('telefone-error').textContent, /telefone válido/);
});

test('admin: curso com mais de 25 inscritos continua visível e mostra todos os cadastros', async (t) => {
  const many = Array.from({ length: 32 }, (_, index) => ({
    id: String(index), nome: `Participante ${index + 1}`, telefone: '+5581999991234', curso: 'sites-ia', criado_em: '2026-09-23T12:30:00.000Z',
  }));
  const ui = browser(t, 'admin', path => path.endsWith('/session')
    ? ok({ autenticado: true })
    : ok({ cursos: courses.map(course => ({ ...course, inscritos: course.id === 'sites-ia' ? 32 : 0 })), inscricoes: many, total: 32 }));
  await flush();
  assert.equal(ui.byId('total-count').textContent, '32');
  assert.equal(ui.document.querySelectorAll('.course-card').length, 4);
  const course = ui.document.querySelector('[data-course="sites-ia"]');
  assert.equal(course.disabled, false);
  course.click();
  assert.equal(ui.document.querySelectorAll('.registration-row').length, 32);
  assert.equal(ui.byId('course-filter').value, 'sites-ia');
});
