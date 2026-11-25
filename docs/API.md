# API

Base: mesma origem do site (`/api`). Autenticação por cookie `estudai_sid` (HttpOnly, SameSite=Lax).
Erros seguem sempre o formato `{ "error": { "code", "message", "fields"? } }`.

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| GET | `/api/health` | não | Verificação de saúde |
| POST | `/api/auth/register` | não | Cria conta `{name, email, password}` → 201 |
| POST | `/api/auth/login` | não | `{email, password, remember?}` → cria sessão |
| POST | `/api/auth/logout` | — | Encerra a sessão → 204 |
| GET | `/api/auth/me` | sim | Usuário logado |
| POST | `/api/auth/forgot-password` | não | `{email}` → mensagem genérica (não revela se o e-mail existe). Envia link por SMTP |
| GET | `/api/auth/reset-password/validate?token=` | não | `{valid, reason?}` |
| POST | `/api/auth/reset-password` | não | `{token, password}` → nova senha; invalida token e sessões |
| GET | `/api/materials?q=&category=` | sim | Lista `{items, total}` (busca sem acento/caixa; máx. 500) |
| POST | `/api/materials` | sim | `multipart/form-data`: `title, discipline, category, description?, file` |
| GET | `/api/materials/:id/download` | sim | Baixa o arquivo e soma 1 ao contador |
| DELETE | `/api/materials/:id` | autor | Exclui apostila e arquivo |
| GET | `/api/communities?q=&joined=1` | sim | Lista comunidades |
| POST | `/api/communities` | sim | `{name, description}`; criador entra como membro |
| PUT / DELETE | `/api/communities/:id/membership` | sim | Entrar / sair (idempotentes) |
| DELETE | `/api/communities/:id` | criador | Exclui comunidade |
| POST | `/api/feedback` | sim | `{rating (1-5), category, area, message (10-1000), allowContact?}` → 201. Máx. 5 envios / 10 min por usuário |
| GET | `/api/feedback/mine` | sim | Feedbacks enviados pelo próprio usuário (20 mais recentes) |
| GET | `/api/admin/stats` | admin | Dashboard: usuários (mês / ao vivo), comunidades, totais e listas recentes |

O campo `isAdmin` (boolean) entra nas respostas de `/api/auth/me`, login e registro. Rotas `/api/admin/*` exigem `is_admin = true` no banco (403 caso contrário).

Códigos de erro usados pelo front: `EMAIL_NOT_FOUND`, `WRONG_PASSWORD`, `EMAIL_TAKEN`, `NAME_TAKEN`,
`FILE_TOO_LARGE`, `INVALID_FILE_TYPE`, `RATE_LIMITED`, `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`.

Feedback: `category` ∈ `Elogio | Sugestão | Problema | Outro`; `area` ∈ `Geral | Apostilas | Comunidades | Chat | Conta e login`.
