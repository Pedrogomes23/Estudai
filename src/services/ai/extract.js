/**
 * Extração de texto de arquivos para a Klyra (PDF / TXT / MD).
 */
import { createClient } from '@supabase/supabase-js';
import { notFound, badRequest } from '../../lib/errors.js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function extractPdf(buffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return (data?.text || '').trim();
  } catch (err) {
    // fallback se o pacote não estiver instalado
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('Leitura de PDF não disponível no servidor. Instale pdf-parse ou envie TXT/MD.');
    }
    throw new Error('Não foi possível ler este PDF.');
  }
}

/**
 * @param {{ buffer: Buffer, originalname?: string, mimetype?: string }} file
 */
export async function extractFileText(file) {
  if (!file?.buffer) throw badRequest('Arquivo inválido.');
  const name = (file.originalname || '').toLowerCase();
  const mime = file.mimetype || '';

  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || mime.startsWith('text/')) {
    return file.buffer.toString('utf8').trim();
  }

  if (name.endsWith('.pdf') || mime === 'application/pdf') {
    return extractPdf(file.buffer);
  }

  throw new Error('Formato não suportado. Use PDF, TXT ou MD.');
}

/**
 * Baixa o material do storage e extrai texto.
 */
export async function extractMaterialText(db, _config, userId, materialId) {
  const row = await db.get(
    `SELECT id, title, file_name, storage_key, author_id
       FROM materials WHERE id = $1`,
    [materialId],
  );
  if (!row) throw notFound('Material não encontrado.');

  // Qualquer usuário autenticado pode usar materiais públicos do site
  const supabase = getSupabase();
  if (!supabase) {
    const err = new Error('Storage não configurado.');
    err.status = 500;
    err.code = 'CONFIG_ERROR';
    throw err;
  }

  const { data, error } = await supabase.storage.from('materials').download(row.storage_key);
  if (error || !data) {
    const err = new Error('Não foi possível baixar o material.');
    err.status = 502;
    err.code = 'DOWNLOAD_FAILED';
    throw err;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const fakeFile = {
    buffer,
    originalname: row.file_name || 'material.pdf',
    mimetype: '',
  };
  return extractFileText(fakeFile);
}
