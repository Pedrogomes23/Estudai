# Estudaí!

Plataforma colaborativa de estudos: repositório de apostilas e resumos, e comunidades de estudo com chat e lista de participantes.

## Como rodar

Requer Node.js 22.13 ou superior e um banco PostgreSQL (o projeto usa o do Supabase). Copie `.env.example` para `.env` e preencha `DATABASE_URL`. As tabelas são criadas automaticamente na primeira execução. Para rodar os testes é preciso um PostgreSQL local de teste (`TEST_DATABASE_URL`, veja `.env.example`).

```bash
npm install
cp .env.example .env     # opcional
npm run dev              # http://localhost:3000
```

| Comando | O que faz |
| --- | --- |
| `npm start` | Sobe o servidor (produção) |
| `npm run dev` | Sobe com reinício automático |
| `npm test` | Testes automatizados (API completa) |
| `npm run lint` / `npm run format:check` | Qualidade e formatação do código |

Com Docker: `docker compose up --build`.

## Dashboard administrativo

Acesso restrito a contas com `is_admin = true`. Na primeira execução (ou quando ainda não existir admin), a plataforma cria automaticamente:

| Campo | Valor |
| --- | --- |
| E-mail | `admin@estudai.local` |
| Senha | `AdminEstudaí2024!` |

Entre com essa conta e abra `/admin.html` (ou o link **Dashboard** no menu). O painel mostra usuários do último mês, usuários ativos ao vivo, comunidades e totais. **Altere a senha do admin em produção.**

## Estrutura

```
public/                 Front-end (HTML/CSS/JS puro, sem build)
  index.html            Página inicial + login/cadastro
  plataforma.html       Área logada: apostilas, comunidades e sala de chat (#comunidade-ID)
  feedback.html         Área logada: formulário de feedback (nota, tipo, área e mensagem)
  admin.html            Dashboard administrativo (somente is_admin)
  css/                  base.css + home.css + platform.css + feedback.css + admin.css
  js/lib/               api.js (cliente REST), dom.js (utilidades)
  js/features/          auth.js
  js/pages/             ponto de entrada de cada página
  assets/img/           logo e ícones
src/                    Back-end (Node + Express 5 + PostgreSQL (pacote pg))
  app.js                Middlewares, segurança e rotas
  config.js             Variáveis de ambiente
  db/index.js           Schema versionado (migrações) e dados iniciais
  lib/                  senhas (scrypt), sessões, validação (zod), erros
  middleware/           auth, CSRF por origem, tratamento de erros
  routes/               auth, admin, materials, communities, feedback, health
tests/                  Testes com o runner nativo do Node
docs/API.md             Referência da API
```

## O que mudou em relação ao protótipo

O protótipo guardava contas, apostilas e comunidades no `localStorage`/IndexedDB de cada navegador: ninguém via
o que outro usuário enviava e a "segurança" do login podia ser burlada editando o armazenamento do navegador.
Agora:

- **Contas e login reais**: senha com scrypt + sal, sessão no servidor (cookie HttpOnly), logout que invalida de verdade,
  limite de tentativas de login.
- **Comunidades com chat**: ao entrar, o estudante abre a sala com mensagens e a lista de participantes.
- **Dados compartilhados**: apostilas, comunidades e mensagens ficam no PostgreSQL; arquivos em `data/uploads` com nome aleatório.
- **Autorização no servidor**: só o autor exclui a apostila; só o criador exclui a comunidade.
- **Segurança**: CSP restritiva (sem scripts/estilos inline), Helmet, validação de entrada, checagem de `Origin`,
  tipos de arquivo permitidos e limite de 25 MB.
- **Código organizado**: CSS e JS saíram do HTML (nada de `onclick` inline), sem duplicação entre `index` e `login`.
- **Front-end visualmente idêntico**: verificado comparando capturas de tela antes/depois (telas de login, home,
  plataforma e modais, em desktop e celular).

## Publicação

Backend no Render (Web Service, Node), banco no Supabase. No painel do Render use Build Command `npm ci` e Start Command `npm start`, e defina as variáveis de ambiente: `DATABASE_URL` (Session pooler do Supabase), `NODE_ENV=production` e `TRUST_PROXY=true`. Nunca coloque a senha do banco no código nem no GitHub. Atenção: o disco do Render grátis é apagado a cada deploy/reinício, então as apostilas enviadas (arquivos) não persistem até serem movidas para o Supabase Storage.

Migração única dos dados do antigo SQLite: `npm run db:migrate-sqlite -- data/estudai.db` (com `DATABASE_URL` no `.env`). Depois de definir o domínio, atualize `public/robots.txt` e
`public/sitemap.xml`.

## Publicação na Vercel

1. Suba o projeto no GitHub e importe na Vercel (framework: **Other**; sem Build Command e sem Output Directory).
2. Em **Settings > Environment Variables** defina: `DATABASE_URL` (Supabase, **Session pooler**, porta 5432), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (ex.: `Estudaí! <contato@seudominio.com>`) e `PUBLIC_APP_URL` (ex.: `https://seu-app.vercel.app`, usada no link do e-mail de recuperação).
3. Faça o deploy. `NODE_ENV=production` e o proxy HTTPS já são tratados automaticamente pela Vercel.

Como funciona: `api/index.js` exporta o Express como função serverless, `vercel.json` encaminha `/api/*` para ela e a pasta `public/` é servida pela CDN. Limitações na Vercel: uploads de apostilas vão para `/tmp` (temporário, não persistente) e o corpo da requisição é limitado a 4,5 MB; para usar apostilas em produção, mova os arquivos para o Supabase Storage. O limite de tentativas (rate limit) é por instância.

## Decisões e limitações conhecidas

- A tela de login diz se o e-mail existe ou se a senha está errada (mantido para não alterar o comportamento do front);
  um endurecimento futuro é mensagem única + rate limit por e-mail.
- Recuperação de senha e confirmação de e-mail ainda não existem.
- O chat usa atualização a cada 3 segundos (polling), sem WebSocket: simples e sem dependências. Só membros leem e escrevem; mostra as 100 mensagens mais recentes. Quem criou a comunidade pode apagar qualquer mensagem.
- Os arquivos das apostilas ainda ficam em disco (`DATA_DIR/uploads`). Em hospedagem com disco efêmero (Render grátis) eles somem a cada deploy; o próximo passo é movê-los para o Supabase Storage.
- A listagem retorna até 500 itens; paginação é o próximo passo se o volume crescer.

## Cookies e HTTPS

- **Política de Cookies**: página `public/politica-de-cookies.html` e aviso de consentimento (`public/js/lib/cookie-consent.js`
  + `public/css/cookies.css`), carregado por uma linha `<script>` em cada página. A escolha fica no `localStorage`
  (`estudai_cookie_consent`) e vale 12 meses. Se um dia houver cookies não essenciais (analytics etc.), ouça o evento
  `estudai:cookie-consent` e só carregue o recurso quando `detail.choice === 'all'`; atualize a tabela da política.
- **SSL/HTTPS**: no Render o certificado é automático. Para servidor próprio há `npm run start:https`
  (`src/server-https.js`), redirecionamento HTTP→HTTPS e script de certificado de teste. Detalhes em `docs/HTTPS.md`.
