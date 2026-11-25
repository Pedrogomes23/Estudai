#!/usr/bin/env sh
# Gera um certificado AUTOASSINADO para testar HTTPS em localhost (o navegador mostrará um aviso).
# Para o site de verdade use um certificado válido (Let's Encrypt): veja docs/HTTPS.md.
# Uso: sh scripts/generate-dev-cert.sh [pasta-de-saida]
set -eu
DIR="${1:-certs}"
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
  -keyout "$DIR/localhost-key.pem" -out "$DIR/localhost-cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
chmod 600 "$DIR/localhost-key.pem"
echo "Certificado criado em $DIR/. Configure no .env:"
echo "  SSL_KEY_PATH=$DIR/localhost-key.pem"
echo "  SSL_CERT_PATH=$DIR/localhost-cert.pem"
echo "e rode: npm run start:https"
