import multer from 'multer';
import { HttpError } from '../lib/errors.js';

export function apiNotFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
}

export function errorHandler(config) {
  // O Express identifica handler de erro pela aridade (4 args), por isso `next` precisa existir.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let status = 500;
    let body = { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente em instantes.' };

    if (err instanceof HttpError) {
      status = err.status;
      body = { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) };
    } else if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      body = {
        code: err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
        message:
          err.code === 'LIMIT_FILE_SIZE'
            ? `O arquivo excede o limite de ${Math.round(config.uploadMaxBytes / 1048576)} MB.`
            : 'Não foi possível processar o upload.',
      };
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'INVALID_JSON', message: 'Corpo da requisição inválido.' };
    }

    if (status >= 500 && config.logFormat) console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
    res.status(status).json({ error: body });
  };
}
