# SSL / HTTPS

O certificado SSL (na verdade TLS) é emitido para **um domínio** por uma autoridade certificadora; ele não pode
ser gerado "dentro do código". O projeto agora aceita os dois cenários abaixo.

## 1. Hospedagem com HTTPS automático (Render, Railway, Fly...) — o seu caso atual

Nada a instalar: o Render emite e renova de graça um certificado Let's Encrypt para `*.onrender.com` e para o
seu domínio próprio (Dashboard > Settings > Custom Domains > adicione o domínio e aponte o DNS). Continue usando
`npm start` com:

```
NODE_ENV=production
TRUST_PROXY=true
PUBLIC_APP_URL=https://seudominio.com
```

Isso já ativa cookie `Secure`, `upgrade-insecure-requests` e o cabeçalho HSTS (Helmet).

## 2. Servidor próprio (VPS, Docker, máquina local) — HTTPS direto no Node

Nova entrada `src/server-https.js` (não altera o `src/server.js`):

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `SSL_KEY_PATH` | chave privada `.pem` | obrigatória |
| `SSL_CERT_PATH` | certificado `.pem` (use o `fullchain.pem`) | obrigatória |
| `SSL_CA_PATH` | cadeia extra, se precisar | — |
| `SSL_PASSPHRASE` | senha da chave, se tiver | — |
| `HTTPS_PORT` | porta HTTPS (use `443` em produção) | `3443` |
| `PORT` | porta HTTP, que só redireciona para o HTTPS | `3000` |
| `HTTP_REDIRECT` | `false` desliga o redirecionamento | ligado |

```bash
npm run start:https     # ou npm run dev:https
```

### Testar localmente (certificado autoassinado)

```bash
npm run ssl:dev-cert    # cria certs/localhost-*.pem
# .env: SSL_KEY_PATH=certs/localhost-key.pem  SSL_CERT_PATH=certs/localhost-cert.pem
npm run start:https     # https://localhost:3443  (o navegador avisa que não é confiável: é esperado)
```

### Certificado válido e gratuito (Let's Encrypt)

Com o domínio apontando para o servidor e a porta 80 livre:

```bash
sudo certbot certonly --standalone -d seudominio.com
# .env:
# SSL_KEY_PATH=/etc/letsencrypt/live/seudominio.com/privkey.pem
# SSL_CERT_PATH=/etc/letsencrypt/live/seudominio.com/fullchain.pem
# HTTPS_PORT=443   PORT=80   PUBLIC_APP_URL=https://seudominio.com
```

O certificado vence em ~90 dias. Depois de cada renovação, recarregue sem derrubar o site com
`kill -HUP <pid-do-node>` (o servidor relê os arquivos). As chaves `.pem` nunca devem ir para o GitHub
(`.gitignore` já ignora `certs/` e `*.pem`).
