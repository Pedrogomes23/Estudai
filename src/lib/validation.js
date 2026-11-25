import { z } from 'zod';
import { badRequest } from './errors.js';

const text = (label, max) =>
  z
    .string({ error: `${label} é obrigatório.` })
    .trim()
    .min(1, `${label} é obrigatório.`)
    .max(max, `${label} deve ter no máximo ${max} caracteres.`);

export const CATEGORIES = ['Apostila', 'Resumo'];
export const FEEDBACK_CATEGORIES = ['Elogio', 'Sugestão', 'Problema', 'Outro'];
export const FEEDBACK_AREAS = ['Geral', 'Apostilas', 'Comunidades', 'Chat', 'Conta e login'];

export const schemas = {
  register: z.object({
    name: text('Nome', 80),
    email: z.string().trim().toLowerCase().max(254).email('E-mail inválido.'),
    password: z
      .string({ error: 'Crie uma senha.' })
      .min(8, 'Use pelo menos 8 caracteres.')
      .max(200, 'Senha muito longa.'),
  }),
  login: z.object({
    email: z.string().trim().toLowerCase().max(254).email('E-mail inválido.'),
    password: z.string().min(1, 'Digite sua senha.').max(200),
    remember: z.boolean().optional().default(false),
  }),
  material: z.object({
    title: text('Título', 80),
    discipline: text('Disciplina', 60),
    category: z.enum(CATEGORIES, { error: 'Categoria inválida.' }),
    description: z.string().trim().max(200, 'A descrição deve ter no máximo 200 caracteres.').default(''),
  }),
  message: z.object({ body: text('Mensagem', 1000) }),
  feedback: z.object({
    rating: z
      .number({ error: 'Escolha uma nota de 1 a 5.' })
      .int('Escolha uma nota de 1 a 5.')
      .min(1, 'Escolha uma nota de 1 a 5.')
      .max(5, 'Escolha uma nota de 1 a 5.'),
    category: z.enum(FEEDBACK_CATEGORIES, { error: 'Escolha o tipo de feedback.' }),
    area: z.enum(FEEDBACK_AREAS, { error: 'Escolha a área do Estudaí!.' }),
    message: z
      .string({ error: 'Conte um pouco mais sobre sua opinião.' })
      .trim()
      .min(10, 'Escreva pelo menos 10 caracteres.')
      .max(1000, 'A mensagem deve ter no máximo 1000 caracteres.'),
    allowContact: z.boolean().optional().default(false),
  }),
  community: z.object({
    name: text('Nome', 60),
    description: text('Descrição', 160),
  }),
  forgotPassword: z.object({
    email: z.string().trim().toLowerCase().max(254).email('E-mail inválido.'),
  }),
  resetPassword: z.object({
    token: z
      .string({ error: 'Link inválido.' })
      .trim()
      .min(20, 'Link inválido.')
      .max(200, 'Link inválido.'),
    password: z
      .string({ error: 'Crie uma nova senha.' })
      .min(8, 'Use pelo menos 8 caracteres.')
      .max(200, 'Senha muito longa.')
      .regex(/[A-Za-zÀ-ÿ]/, 'Inclua pelo menos uma letra.')
      .regex(/[0-9]/, 'Inclua pelo menos um número.'),
  }),
};

/** Valida `data` com o schema e lança 400 com mensagens por campo. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_');
    fields[key] ??= issue.message;
  }
  throw badRequest(Object.values(fields)[0], fields);
}

export function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw badRequest('Identificador inválido.');
  return id;
}
