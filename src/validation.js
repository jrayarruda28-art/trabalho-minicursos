export class HttpError extends Error {
  constructor(status, message, codigo) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

const courses = new Set(['sites-ia', 'impressao-3d', 'corte-laser', 'ecommerce']);

export function validarInscricao(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new HttpError(400, 'Preencha os dados da inscrição.');
  }
  const nome = typeof dados.nome === 'string' ? dados.nome.trim().replace(/\s+/g, ' ') : '';
  if (nome.length < 3 || nome.length > 120 || !/^[\p{L}\p{M}][\p{L}\p{M}'’ .-]*$/u.test(nome) || nome.split(' ').filter(parte => /\p{L}/u.test(parte)).length < 2) {
    throw new HttpError(400, 'Informe seu nome e sobrenome, com até 120 caracteres.');
  }
  let telefone = typeof dados.telefone === 'string' ? dados.telefone : '';
  if (telefone.length > 24 || /[^\d\s()+.\-]/.test(telefone)) throw new HttpError(400, 'Informe um telefone brasileiro válido com DDD.');
  telefone = telefone.replace(/\D/g, '');
  if ((telefone.length === 12 || telefone.length === 13) && telefone.startsWith('55')) telefone = telefone.slice(2);
  if (!/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(telefone)) throw new HttpError(400, 'Informe um telefone brasileiro válido com DDD.');
  if (!courses.has(dados.curso)) throw new HttpError(400, 'Escolha um dos quatro minicursos.');
  return { nome, telefone: '+55' + telefone, curso: dados.curso };
}
