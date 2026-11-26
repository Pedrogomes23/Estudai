const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 250;
const MAX_CONTEXT_CHARS = 10000;

const STOP_WORDS = new Set([
  'para',
  'como',
  'mais',
  'menos',
  'sobre',
  'entre',
  'quando',
  'onde',
  'qual',
  'quais',
  'porque',
  'porquê',
  'uma',
  'umas',
  'uns',
  'dos',
  'das',
  'que',
  'com',
  'sem',
  'por',
  'pelo',
  'pela',
  'seus',
  'suas',
  'esse',
  'essa',
  'isso',
  'este',
  'esta',
  'isto',
  'meu',
  'minha',
  'seu',
  'sua',
  'ele',
  'ela',
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getTerms(value) {
  return (
    normalize(value)
      .match(/[a-z0-9]{3,}/g)
      ?.filter((term) => !STOP_WORDS.has(term)) || []
  );
}

function splitIntoChunks(text) {
  const chunks = [];
  const content = String(text || '').trim();

  for (let start = 0; start < content.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = content.slice(start, start + CHUNK_SIZE).trim();
    if (chunk) chunks.push({ text: chunk, start });
  }

  return chunks;
}

function isGlobalQuestion(question) {
  const q = normalize(question);

  return /\b(resuma|resumo|sintetize|sintese|visao geral|documento inteiro|material inteiro|todo o documento|todo o material|principais pontos|crie questoes|questoes sobre tudo)\b/.test(
    q,
  );
}

export function selectRelevantDocumentContext(documentText, question, options = {}) {
  const requestedMaxChars = options.maxChars == null ? MAX_CONTEXT_CHARS : Number(options.maxChars);
  const maxChars = Math.max(
    0,
    Math.min(Number.isFinite(requestedMaxChars) ? requestedMaxChars : MAX_CONTEXT_CHARS, MAX_CONTEXT_CHARS),
  );
  if (maxChars === 0) return '';

  const chunks = splitIntoChunks(documentText);
  if (!chunks.length) return '';

  const terms = [...new Set(getTerms(question))];
  const global = isGlobalQuestion(question);

  const scored = chunks.map((chunk, index) => {
    const content = normalize(chunk.text);
    let score = 0;

    for (const term of terms) {
      const matches = content.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'));
      if (matches) score += Math.min(matches.length, 5);
    }

    if (global) {
      score += 2;
      if (index === 0 || index === chunks.length - 1) score += 3;
    }

    return { ...chunk, index, score };
  });

  if (global && chunks.length > 1) {
    const distributed = [];
    const count = Math.min(4, chunks.length);

    for (let i = 0; i < count; i++) {
      const index = Math.round((i * (chunks.length - 1)) / Math.max(1, count - 1));
      distributed.push(scored[index]);
    }

    const selected = new Map(distributed.map((chunk) => [chunk.index, chunk]));

    for (const chunk of [...scored].sort((a, b) => b.score - a.score)) {
      if (selected.size >= 8) break;
      selected.set(chunk.index, chunk);
    }

    return [...selected.values()]
      .sort((a, b) => a.index - b.index)
      .reduce((result, chunk) => {
        const part = `\n\n[Trecho ${chunk.index + 1}]\n${chunk.text}`;
        return result.length + part.length <= maxChars ? result + part : result;
      }, '')
      .trim();
  }

  const selected = scored
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!selected.length) {
    return chunks[0].text.slice(0, maxChars);
  }

  let result = '';

  for (const chunk of selected) {
    const prefix = result ? '\n\n' : '';
    const label = `[Trecho ${chunk.index + 1}]\n`;
    const available = maxChars - result.length - prefix.length - label.length;

    if (available <= 0) continue;

    let excerpt = chunk.text;

    if (excerpt.length > available && terms.length) {
      const normalizedExcerpt = normalize(excerpt);
      const positions = terms
        .map((term) => normalizedExcerpt.indexOf(term))
        .filter((position) => position >= 0);

      if (positions.length) {
        const firstPosition = Math.min(...positions);
        const start = Math.max(0, firstPosition - Math.floor(available / 3));
        excerpt = excerpt.slice(start, start + available);
      }
    }

    result += prefix + label + excerpt.slice(0, available);
  }

  return result.trim();
}

export const DOCUMENT_CONTEXT_LIMITS = {
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
  maxContextChars: MAX_CONTEXT_CHARS,
};
