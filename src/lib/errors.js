/** Erro de aplicação com status HTTP e código estável para o front-end. */
export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, fields) => new HttpError(400, 'VALIDATION_ERROR', message, fields);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Faça login para continuar.') =>
  new HttpError(401, code, message);
export const forbidden = (message = 'Você não tem permissão para isso.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Não encontrado.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new HttpError(409, code, message);
