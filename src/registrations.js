import { HttpError } from './validation.js';

export async function registrarInscricao(pool, dados) {
  try {
    // Uma chamada atômica; a capacidade do curso não limita o número de inscrições.
    const result = await pool.query('SELECT * FROM public.registrar_inscricao($1, $2, $3)', [dados.nome, dados.telefone, dados.curso]);
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'Este telefone já tem uma inscrição neste minicurso.', 'INSCRICAO_DUPLICADA');
    if (error.code === 'P0002') throw new HttpError(400, 'Minicurso não encontrado.');
    throw error;
  }
}
