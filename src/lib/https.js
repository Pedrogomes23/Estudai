import fs from 'node:fs';
import http from 'node:http';

/** Lê o certificado e a chave privada indicados nas variáveis SSL_* (veja docs/HTTPS.md). */
export function loadTlsOptions(env = process.env) {
  const {
    SSL_KEY_PATH: keyPath,
    SSL_CERT_PATH: certPath,
    SSL_CA_PATH: caPath,
    SSL_PASSPHRASE: passphrase,
  } = env;
  if (!keyPath || !certPath) {
    throw new Error('Defina SSL_KEY_PATH e SSL_CERT_PATH (caminhos dos arquivos .pem). Veja docs/HTTPS.md.');
  }
  const read = (file, label) => {
    try {
      return fs.readFileSync(file);
    } catch (err) {
      throw new Error(`Não foi possível ler ${label} em "${file}": ${err.code || err.message}`);
    }
  };
  return {
    key: read(keyPath, 'a chave privada'),
    cert: read(certPath, 'o certificado'),
    ...(caPath && { ca: read(caPath, 'a cadeia de certificados') }),
    ...(passphrase && { passphrase }),
    minVersion: 'TLSv1.2',
  };
}

/**
 * Servidor HTTP que só redireciona (301) para o HTTPS.
 * O destino usa o host fixo da configuração, nunca o cabeçalho Host da requisição (evita open redirect).
 */
export function createHttpsRedirect({ hostname, httpsPort }) {
  const host = hostname.includes(':') ? `[${hostname}]` : hostname;
  const port = httpsPort === 443 ? '' : `:${httpsPort}`;
  return http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${host}${port}${req.url}` });
    res.end();
  });
}
