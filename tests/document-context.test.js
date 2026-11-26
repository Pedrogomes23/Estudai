import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectRelevantDocumentContext,
  DOCUMENT_CONTEXT_LIMITS,
} from '../src/services/ai/document-context.js';

test('encontra trechos relacionados à pergunta', () => {
  const document = [
    'Introdução: conceitos gerais de estudo. '.repeat(60),
    'Banco de dados relacionais utilizam tabelas, chaves primárias e estrangeiras. '.repeat(25),
    'Fotossíntese é o processo pelo qual plantas produzem energia. '.repeat(25),
  ].join('\n');

  const result = selectRelevantDocumentContext(
    document,
    'Explique as chaves primárias e estrangeiras do banco de dados',
  );

  assert.match(result, /primárias/i);
  assert.match(result, /estrangeiras/i);
});

test('seleciona partes distribuídas para resumo geral', () => {
  const document = Array.from({ length: 20 }, (_, i) =>
    `Capítulo ${i + 1}: assunto exclusivo do capítulo ${i + 1}. `.repeat(60),
  ).join('\n');

  const result = selectRelevantDocumentContext(document, 'Faça um resumo do documento inteiro');

  assert.match(result, /Capítulo 1/);
  assert.ok(result.length <= DOCUMENT_CONTEXT_LIMITS.maxContextChars);
  assert.ok(result.length > 1000);
});

test('respeita limite pequeno sem perder o termo pesquisado', () => {
  const word = 'Fotoss\u00edntese';
  const document = `${word} e o processo de producao de energia pelas plantas. `.repeat(100);

  const result = selectRelevantDocumentContext(document, `Explique a ${word}`, { maxChars: 1000 });

  const normalized = result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  assert.ok(result.length <= 1000);
  assert.ok(result.length > 0);
  assert.ok(normalized.includes('fotossintese'));
  assert.ok(normalized.includes('producao'));
});

test('respeita o limite máximo de contexto', () => {
  const document = 'Conteúdo acadêmico importante. '.repeat(3000);

  const result = selectRelevantDocumentContext(document, 'Explique conteúdo acadêmico importante', {
    maxChars: 3000,
  });

  assert.ok(result.length <= 3000);
});

test('retorna texto vazio para documento vazio', () => {
  assert.equal(selectRelevantDocumentContext('', 'Resuma o documento'), '');
});
