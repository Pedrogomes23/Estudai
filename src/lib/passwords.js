import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Parâmetros scrypt (OWASP: N=2^15, r=8, p=1). Ficam gravados no hash para permitir evolução futura.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * 1024 * 1024;

function derive(password, salt, n, r, p, keylen) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Formato: scrypt$N$r$p$salt(b64)$hash(b64) */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), +n, +r, +p, expected.length);
  return timingSafeEqual(actual, expected);
}

// Hash descartável usado quando o e-mail não existe, para o tempo de resposta não revelar contas.
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));
