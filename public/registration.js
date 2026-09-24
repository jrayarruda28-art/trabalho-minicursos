'use strict';
    const INSCRICAO_ENDPOINT = '/api/inscricoes';
    const CURSOS = Object.freeze({
      'sites-ia': { nome: 'Desenvolvimento de sites com IA', data: '29/09' },
      'impressao-3d': { nome: 'Modelagem e impressão 3D', data: '29/10' },
      'corte-laser': { nome: 'Corte a laser', data: '24/11' },
      'ecommerce': { nome: 'E-commerce', data: '10 a 13/12' }
    });
    const form = document.getElementById('registration-form');
    const nome = document.getElementById('nome');
    const telefone = document.getElementById('telefone');
    const curso = document.getElementById('curso');
    const submitButton = document.getElementById('submit-button');
    const submitLabel = submitButton.querySelector('span');
    const status = document.getElementById('form-status');
    const campos = [nome, telefone, curso];
    let enviando = false;


    function digitosDoTelefone(valor) {
      let digitos = valor.replace(/\D/g, '');
      if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
      return digitos;
    }

    function formatarTelefone(valor) {
      const digitos = digitosDoTelefone(valor);
      if (digitos.length !== 10 && digitos.length !== 11) return valor;
      const corte = digitos.length === 11 ? 7 : 6;
      return '(' + digitos.slice(0, 2) + ') ' + digitos.slice(2, corte) + '-' + digitos.slice(corte);
    }

    function validarCampo(campo) {
      let mensagem = '';
      if (campo === nome) {
        const valor = campo.value.trim().replace(/\s+/g, ' ');
        if (!valor) mensagem = 'Preencha seu nome completo.';
        else if (valor.length < 3 || valor.length > 120 || !/^[\p{L}\p{M}][\p{L}\p{M}'’ .-]*$/u.test(valor) || valor.split(' ').filter(parte => /\p{L}/u.test(parte)).length < 2) mensagem = 'Informe seu nome e sobrenome.';
      }
      if (campo === telefone) {
        const digitos = digitosDoTelefone(campo.value);
        if (!campo.value.trim()) mensagem = 'Preencha seu telefone com DDD.';
        else if (!/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(digitos) || /[^\d\s()+.\-]/.test(campo.value)) mensagem = 'Informe um telefone válido com DDD: (81) 99999-9999.';
      }
      if (campo === curso && !Object.hasOwn(CURSOS, campo.value)) mensagem = 'Escolha um dos quatro minicursos.';
      const erro = document.getElementById(campo.id + '-error');
      erro.textContent = mensagem;
      if (mensagem) campo.setAttribute('aria-invalid', 'true');
      else campo.removeAttribute('aria-invalid');
      return !mensagem;
    }

    function mostrarStatus(mensagem, estado) {
      status.textContent = mensagem;
      status.dataset.state = estado;
      status.hidden = false;
      status.focus({ preventScroll: true });
      status.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }

    campos.forEach(campo => {
      campo.addEventListener('blur', () => {
        if (campo === telefone) campo.value = formatarTelefone(campo.value);
        if (campo.value || campo.hasAttribute('aria-invalid')) validarCampo(campo);
      });
      campo.addEventListener(campo === curso ? 'change' : 'input', () => {
        if (campo.hasAttribute('aria-invalid')) validarCampo(campo);
        status.hidden = true;
      });
    });

    document.querySelectorAll('[data-course]').forEach(botao => {
      botao.addEventListener('click', () => {
        if (enviando) return;
        curso.value = botao.dataset.course;
        curso.dispatchEvent(new Event('change'));
        document.getElementById('inscricao').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        nome.focus({ preventScroll: true });
      });
    });

    async function enviarInscricao(dados) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(INSCRICAO_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(dados),
          signal: controller.signal
        });
        const resultado = await response.json();
        if (response.status === 409 || response.status === 400) throw new Error(resultado.mensagem || 'Confira os dados da inscrição e tente novamente.');
        if (response.status === 429) throw new Error('Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.');
        if (!response.ok) throw new Error('Não foi possível confirmar a inscrição. Seus dados continuam no formulário para tentar novamente.');
        if (resultado.sucesso !== true) throw new Error('A inscrição ainda não foi confirmada. Tente novamente em instantes.');
      } finally {
        clearTimeout(timeout);
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (enviando) return;
      status.hidden = true;
      const validacoes = campos.map(validarCampo);
      if (validacoes.includes(false)) {
        campos[validacoes.indexOf(false)].focus();
        return;
      }
      nome.value = nome.value.trim().replace(/\s+/g, ' ');
      telefone.value = formatarTelefone(telefone.value);
      const dados = { nome: nome.value, telefone: '+55' + digitosDoTelefone(telefone.value), curso: curso.value };
      enviando = true;
      submitButton.disabled = true;
      campos.forEach(campo => { campo.disabled = true; });
      form.setAttribute('aria-busy', 'true');
      submitLabel.textContent = 'Enviando inscrição…';
      try {
        await enviarInscricao(dados);
        mostrarStatus('Inscrição recebida em ' + CURSOS[dados.curso].nome + ' — ' + CURSOS[dados.curso].data + '. Sua próxima ideia já tem um ponto de partida!', 'success');
        form.reset();
      } catch (error) {
        const mensagem = error.name === 'AbortError'
          ? 'A confirmação demorou mais que o esperado. Seus dados foram mantidos; confira sua conexão antes de tentar novamente.'
          : error instanceof TypeError || error instanceof SyntaxError
            ? 'Não foi possível confirmar a inscrição. Confira sua conexão e tente novamente.'
            : error.message;
        mostrarStatus(mensagem, 'error');
      } finally {
        enviando = false;
        submitButton.disabled = false;
        campos.forEach(campo => { campo.disabled = false; });
        form.removeAttribute('aria-busy');
        submitLabel.textContent = 'Solicitar minha inscrição';
      }
    });
