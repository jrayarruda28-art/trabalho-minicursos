(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fallbackCourses = [
    { id: 'sites-ia', nome: 'Criação de sites com IA' },
    { id: 'impressao-3d', nome: 'Impressão 3D' },
    { id: 'corte-laser', nome: 'Corte a laser' },
    { id: 'ecommerce', nome: 'E-commerce' }
  ];
  const state = { courses: [], registrations: [], filter: '', query: '', loaded: false, authenticated: false, loading: false, generation: 0 };
  let detailTrigger = null;

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {
        credentials: 'same-origin', cache: 'no-store', ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload.mensagem === 'string' ? payload.mensagem : typeof payload.erro === 'string' ? payload.erro : typeof payload.error === 'string' ? payload.error : 'Não foi possível concluir a solicitação. Tente novamente.';
        throw new ApiError(message, response.status);
      }
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.name === 'AbortError' ? 'A conexão demorou mais que o esperado. Tente novamente.' : 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.', 0);
    } finally { clearTimeout(timer); }
  }

  function notice(id, message) {
    const element = $(id);
    element.textContent = message || '';
    element.hidden = !message;
  }

  function resetData() {
    state.generation += 1;
    state.courses = [];
    state.registrations = [];
    state.loaded = false;
    state.loading = false;
    state.query = '';
    state.filter = '';
    $('search').value = '';
    $('course-filter').replaceChildren(new Option('Todos os cursos', ''));
    $('course-cards').replaceChildren();
    $('registration-list').replaceChildren();
    $('total-count').textContent = '—';
    $('updated-at').textContent = '';
    $('result-count').textContent = '';
    $('refresh').disabled = false;
    $('refresh').querySelector('span').textContent = 'Atualizar';
    $('all-courses').setAttribute('aria-pressed', 'true');
    if ($('detail-dialog').open) $('detail-dialog').close();
    for (const id of ['detail-name', 'detail-phone', 'detail-course', 'detail-course-date', 'detail-date']) $(id).replaceChildren();
    detailTrigger = null;
    notice('dashboard-error', '');
  }

  function showLogin(message = '', focus = true) {
    state.authenticated = false;
    resetData();
    $('session-loading').hidden = true;
    $('dashboard').hidden = true;
    $('logout').hidden = true;
    $('login-view').hidden = false;
    $('senha').value = '';
    notice('login-error', message);
    if (focus) $('usuario').focus();
  }

  function showDashboard() {
    state.authenticated = true;
    $('session-loading').hidden = true;
    $('login-view').hidden = true;
    $('dashboard').hidden = false;
    $('logout').hidden = false;
    $('senha').value = '';
    notice('login-error', '');
    $('dashboard-title').focus();
    loadRegistrations();
  }

  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const courseFor = (id) => state.courses.find((course) => course.id === id);
  const courseName = (id) => courseFor(id)?.nome || id || 'Curso não informado';

  function formatDate(value, includeTime = false) {
    if (!value) return 'Não informada';
    const text = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text);
    if (Number.isNaN(date.getTime())) return text;
    return new Intl.DateTimeFormat('pt-BR', includeTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(date);
  }

  function renderSummary() {
    $('total-count').textContent = state.registrations.length.toLocaleString('pt-BR');
    const cards = document.createDocumentFragment();
    const select = document.createDocumentFragment();
    select.append(new Option('Todos os cursos', ''));
    state.courses.forEach((course, index) => {
      const count = state.registrations.filter((item) => item.curso === course.id).length;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'course-card';
      card.dataset.course = course.id;
      card.setAttribute('aria-pressed', String(state.filter === course.id));
      card.setAttribute('aria-label', `${course.nome}: ${count} ${count === 1 ? 'inscrição' : 'inscrições'}. Filtrar este curso.`);
      const number = document.createElement('span');
      number.className = 'course-number';
      number.textContent = `CURSO ${String(index + 1).padStart(2, '0')}`;
      const name = document.createElement('span');
      name.className = 'course-name';
      name.textContent = course.nome;
      const countWrapper = document.createElement('span');
      countWrapper.className = 'course-count';
      const total = document.createElement('strong');
      total.textContent = count.toLocaleString('pt-BR');
      const label = document.createElement('span');
      label.textContent = count === 1 ? 'inscrição' : 'inscrições';
      countWrapper.append(total, label);
      card.append(number, name, countWrapper);
      card.addEventListener('click', () => changeFilter(course.id));
      cards.append(card);
      select.append(new Option(course.nome, course.id));
    });
    $('course-cards').replaceChildren(cards);
    $('course-filter').replaceChildren(select);
    if (!state.courses.some((course) => course.id === state.filter)) state.filter = '';
    $('course-filter').value = state.filter;
    updateSelectedCourse();
  }

  function updateSelectedCourse() {
    $('all-courses').setAttribute('aria-pressed', String(!state.filter));
    document.querySelectorAll('.course-card').forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.course === state.filter)));
  }

  function changeFilter(id) {
    state.filter = id;
    $('course-filter').value = id;
    updateSelectedCourse();
    renderList();
  }

  function renderList() {
    const query = normalize(state.query);
    const queryDigits = query.replace(/\D/g, '');
    const phoneQuery = /^[\d\s()+.\-]+$/.test(query) && queryDigits.length > 0;
    const records = state.registrations.filter((item) => {
      if (state.filter && item.curso !== state.filter) return false;
      if (!query) return true;
      return normalize(item.nome).includes(query) || normalize(item.telefone).includes(query) || (phoneQuery && String(item.telefone).replace(/\D/g, '').includes(queryDigits));
    });
    const list = document.createDocumentFragment();
    records.forEach((item) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'registration-row';
      button.setAttribute('aria-label', `Ver inscrição de ${item.nome} em ${courseName(item.curso)}`);
      const person = document.createElement('span');
      person.className = 'participant';
      const name = document.createElement('strong');
      name.textContent = item.nome || 'Nome não informado';
      const phone = document.createElement('small');
      phone.textContent = item.telefone || 'Telefone não informado';
      person.append(name, phone);
      const course = document.createElement('span');
      course.className = 'row-course';
      course.textContent = courseName(item.curso);
      const date = document.createElement('span');
      date.className = 'row-date';
      date.textContent = formatDate(item.criado_em);
      const arrow = document.createElement('span');
      arrow.className = 'row-arrow';
      arrow.textContent = '↗';
      arrow.setAttribute('aria-hidden', 'true');
      button.append(person, course, date, arrow);
      button.addEventListener('click', () => openDetails(item, button));
      li.append(button);
      list.append(li);
    });
    $('registration-list').replaceChildren(list);
    const activeFilter = Boolean(state.filter || state.query.trim());
    $('clear-filters').hidden = !activeFilter;
    $('result-count').textContent = state.loaded ? `${records.length.toLocaleString('pt-BR')} ${records.length === 1 ? 'inscrição encontrada' : 'inscrições encontradas'}${activeFilter ? ` de ${state.registrations.length.toLocaleString('pt-BR')} no total` : ''}` : 'Inscrições ainda não carregadas.';
    $('empty-state').hidden = !state.loaded || records.length > 0;
    $('empty-title').textContent = activeFilter ? 'Nenhum participante encontrado' : 'Nenhuma inscrição por enquanto';
    $('empty-description').textContent = activeFilter ? 'Tente outro nome, telefone ou selecione todos os cursos.' : 'Quando alguém se inscrever, os dados aparecerão aqui.';
    document.querySelector('.list-columns').hidden = records.length === 0;
  }

  async function loadRegistrations() {
    if (state.loading || !state.authenticated) return;
    const generation = state.generation;
    state.loading = true;
    $('refresh').disabled = true;
    $('refresh').querySelector('span').textContent = 'Atualizando…';
    $('list-content').setAttribute('aria-busy', 'true');
    $('list-loading').hidden = state.loaded;
    if (!state.loaded) { $('empty-state').hidden = true; document.querySelector('.list-columns').hidden = true; }
    notice('dashboard-error', '');
    try {
      const data = await request('/api/admin/inscricoes');
      if (generation !== state.generation || !state.authenticated) return;
      if (!Array.isArray(data.inscricoes) || !Array.isArray(data.cursos)) throw new ApiError('O servidor retornou dados incompletos. Tente atualizar novamente.', 0);
      state.registrations = data.inscricoes.filter((item) => item && typeof item === 'object');
      state.courses = data.cursos.length ? data.cursos.filter((course) => course && typeof course.id === 'string') : fallbackCourses;
      // Preserve the ability to inspect every registration if an old course is no longer in the catalog.
      for (const item of state.registrations) {
        if (typeof item.curso === 'string' && !state.courses.some((course) => course.id === item.curso)) state.courses.push({ id: item.curso, nome: item.curso });
      }
      state.loaded = true;
      renderSummary();
      renderList();
      $('updated-at').textContent = `Atualizado às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    } catch (error) {
      if (generation !== state.generation || !state.authenticated) return;
      if (error.status === 401) { showLogin('Sua sessão expirou. Entre novamente para continuar.'); return; }
      notice('dashboard-error', `${error.message}${state.loaded ? ' Os dados exibidos são da última atualização.' : ''}`);
      if (!state.loaded) $('result-count').textContent = 'Não foi possível carregar as inscrições. Clique em Atualizar para tentar novamente.';
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        $('refresh').disabled = false;
        $('refresh').querySelector('span').textContent = 'Atualizar';
        $('list-content').setAttribute('aria-busy', 'false');
        $('list-loading').hidden = true;
      }
    }
  }

  function openDetails(item, trigger) {
    detailTrigger = trigger;
    $('detail-name').textContent = item.nome || 'Não informado';
    const digits = String(item.telefone || '').replace(/\D/g, '');
    if (digits) {
      const link = document.createElement('a');
      link.href = `tel:${String(item.telefone).trim().startsWith('+') ? '+' : ''}${digits}`;
      link.textContent = item.telefone;
      $('detail-phone').replaceChildren(link);
    } else $('detail-phone').textContent = item.telefone || 'Não informado';
    $('detail-course').textContent = courseName(item.curso);
    $('detail-course-date').textContent = formatDate(courseFor(item.curso)?.data);
    $('detail-date').textContent = formatDate(item.criado_em, true);
    $('detail-dialog').showModal();
    document.body.classList.add('dialog-open');
    $('close-detail').focus();
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('login-submit').disabled) return;
    const usuario = $('usuario').value.trim();
    const senha = $('senha').value;
    if (!usuario || !senha) { notice('login-error', 'Preencha o usuário e a senha.'); (!usuario ? $('usuario') : $('senha')).focus(); return; }
    $('login-submit').disabled = true;
    $('login-submit').querySelector('span').textContent = 'Entrando…';
    notice('login-error', '');
    $('usuario').removeAttribute('aria-invalid');
    $('senha').removeAttribute('aria-invalid');
    try {
      const data = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ usuario, senha }) });
      if (data.sucesso !== true) throw new ApiError('Não foi possível confirmar o acesso. Tente novamente.', 0);
      showDashboard();
    } catch (error) {
      notice('login-error', error.message);
      if (error.status === 401) { $('usuario').setAttribute('aria-invalid', 'true'); $('senha').setAttribute('aria-invalid', 'true'); }
      $('login-error').focus();
    } finally {
      $('login-submit').disabled = false;
      $('login-submit').querySelector('span').textContent = 'Entrar';
    }
  });

  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try { await request('/api/admin/logout', { method: 'POST' }); showLogin(); }
    catch (error) { if (error.status === 401) showLogin(); else notice('dashboard-error', error.message); }
    finally { $('logout').disabled = false; }
  });
  $('refresh').addEventListener('click', loadRegistrations);
  $('all-courses').addEventListener('click', () => changeFilter(''));
  $('course-filter').addEventListener('change', (event) => changeFilter(event.target.value));
  $('search').addEventListener('input', (event) => { state.query = event.target.value; renderList(); });
  $('clear-filters').addEventListener('click', () => { state.query = ''; $('search').value = ''; changeFilter(''); $('search').focus(); });
  $('close-detail').addEventListener('click', () => $('detail-dialog').close());
  $('done-detail').addEventListener('click', () => $('detail-dialog').close());
  $('detail-dialog').addEventListener('click', (event) => {
    const bounds = $('detail-dialog').getBoundingClientRect();
    if (event.target === $('detail-dialog') && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) $('detail-dialog').close();
  });
  $('detail-dialog').addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    if (detailTrigger?.isConnected && state.authenticated) detailTrigger.focus();
  });
  for (const id of ['usuario', 'senha']) $(id).addEventListener('input', () => $(id).removeAttribute('aria-invalid'));

  (async () => {
    try {
      const data = await request('/api/admin/session');
      if (data.autenticado === true) showDashboard(); else showLogin();
    } catch (error) { showLogin(error.status === 401 ? '' : error.message); }
  })();
})();
