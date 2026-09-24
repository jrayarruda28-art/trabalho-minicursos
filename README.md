# Minicursos — ETE Antônio Arruda de Farias

Site de inscrições com servidor Node.js e banco PostgreSQL/Supabase. O formulário salva nome, telefone, curso e data de inscrição. A área `/admin` permite consultar todos os participantes, filtrar por curso, buscar nome/telefone e abrir os detalhes de cada inscrição.

## Executar

Requer Node.js 22 ou superior.

```bash
npm install
npm start
```

Site: http://localhost:3000. Administração: http://localhost:3000/admin.

O banco deste projeto já foi configurado usando a credencial do `.env`, e o administrador solicitado foi cadastrado. As credenciais ficam somente no servidor. A senha é armazenada no banco como hash scrypt.

## Configurar outro ambiente

1. Copie `.env.example` para `.env` e preencha `DATABASE_URL`, `ADMIN_USERNAME` e `ADMIN_PASSWORD`.
2. Execute `npm run setup` para criar as tabelas e cadastrar o administrador.
3. Execute `npm start`.

`npm run db:migrate` pode ser repetido sem apagar inscrições. `npm run admin:configure` aplica o usuário/senha definidos no ambiente e encerra suas sessões antigas. Essas duas variáveis só são usadas por esse comando; depois da configuração, podem ser retiradas do ambiente de produção.

Tabelas: `minicursos`, `inscricoes`, `administradores` e `sessoes_admin`. Cada curso mantém a capacidade de 25 vagas, mas aceita inscrições além desse número. A quantidade de inscritos não fecha nem oculta cursos. A função `registrar_inscricao` salva cada inscrição em uma única chamada atômica ao banco. O mesmo telefone só pode se inscrever uma vez por curso e pode participar de cursos diferentes.

## Publicação

Este projeto precisa de hospedagem que execute Node.js e consiga acessar o PostgreSQL. Publicar apenas `index.html` em uma hospedagem estática não executa a API. Use `npm ci` na instalação e `npm start` para iniciar; configure `DATABASE_URL`, `NODE_ENV=production` e `APP_ORIGIN` com a origem HTTPS pública (por exemplo, `https://minicursos.exemplo.com`). A porta é lida de `PORT`, com padrão 3000. Execute a migração antes da primeira inicialização em um banco novo.

Se houver um proxy reverso confiável, configure `TRUST_PROXY` com a quantidade correta de saltos (por exemplo, `1` para um único proxy). O proxy deve encaminhar o protocolo e o IP reais e impedir acesso direto ao servidor; isso é necessário para a verificação de origem e os limites por IP. O proxy deve terminar HTTPS. Cookies são `Secure` em produção, `HttpOnly`, `SameSite=Strict` e expiram após oito horas.

As tabelas têm RLS habilitada e acesso negado aos papéis públicos do Supabase. A URL fornecida usa um papel de servidor autorizado; nunca coloque essa credencial no navegador. Os arquivos servidos são a página inicial e os arquivos de `public`, sem expor `.env`, código de servidor ou migrações.

Os limites de tentativas de login e inscrição ficam na memória de um único processo. Para executar várias réplicas, use um armazenamento compartilhado para esses limites ou uma regra equivalente no proxy. Sessões e inscrições já são persistidas no PostgreSQL.

O certificado público em `certs/supabase-ca.crt` valida o TLS do banco, sem desabilitar a verificação do servidor. Referências: [TLS no Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement), [SSL no node-postgres](https://node-postgres.com/features/ssl). Origem do certificado: [Supabase Root 2021 CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).

## Verificar

```bash
npm test
```

Para testar também persistência real, 32 inscrições simultâneas aceitas em um curso que mantém 25 vagas, duplicatas e o fluxo HTTP com sessão:

```bash
RUN_DB_TESTS=1 node --env-file-if-exists=.env --test test/database.integration.test.js
```

Esse teste cria um schema com nome aleatório e o remove ao terminar. Não insere nem apaga inscrições nas tabelas de uso real. Requer permissão de criação de schema.
