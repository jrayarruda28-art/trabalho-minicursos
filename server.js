import app, { applicationPool as pool } from './src/app.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export default app;

// A Vercel importa a aplicação; apenas o comando local abre uma porta.
const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun && process.env.VERCEL !== '1') {
  const port = Number(process.env.PORT || 3000);
  try {
    await pool.query('SELECT id FROM public.minicursos LIMIT 1');
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Site disponível em http://localhost:${port}`);
      console.log(`Área administrativa: http://localhost:${port}/admin`);
    });
    server.on('error', async (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`A porta ${port} já está em uso por outro servidor.`);
        console.error('Encerre a outra instância com Ctrl+C no terminal em que ela foi iniciada e execute novamente.');
        console.error('Para usar outra porta: PORT=3001 npm run dev');
      } else {
        console.error('Não foi possível iniciar o servidor.', error.code || 'ERRO_DESCONHECIDO');
      }
      await pool.end();
      process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      server.close(async () => { await pool.end(); process.exit(0); });
      setTimeout(() => process.exit(1), 10000).unref();
    });
  } catch (error) {
    console.error('Não foi possível conectar ao banco. Confira o .env e execute npm run setup.', error.code || '');
    await pool.end();
    process.exitCode = 1;
  }
}
