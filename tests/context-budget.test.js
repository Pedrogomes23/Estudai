import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateContextBudget, estimateTokens } from '../src/services/ai/context-budget.js';

test('estima tokens de forma conservadora a partir do tamanho do texto', () => {
  assert.equal(estimateTokens('12345'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('mantÃ©m a pergunta atual e limita o histÃ³rico e o documento ao orÃ§amento', () => {
  const history = [
    { role: 'user', content: 'a'.repeat(3000) },
    { role: 'assistant', content: 'b'.repeat(3000) },
  ];
  const result = allocateContextBudget({
    systemInstruction: 'instruÃ§Ãµes '.repeat(80),
    currentMessage: 'pergunta atual '.repeat(80),
    history,
    maxEstimatedTokens: 1200,
  });

  assert.ok(result.history.length > 0);
  assert.ok(result.history.reduce((sum, item) => sum + item.content.length, 0) <= 6000);
  assert.ok(result.documentMaxChars >= 0 && result.documentMaxChars <= 10000);
  assert.ok(result.estimatedInputTokens <= result.maxEstimatedTokens + 1);
});

test('nÃ£o aloca histÃ³rico nem documento quando a mensagem atual jÃ¡ excede o orÃ§amento', () => {
  const result = allocateContextBudget({
    systemInstruction: 's'.repeat(1000),
    currentMessage: 'm'.repeat(10000),
    history: [{ role: 'user', content: 'histÃ³rico' }],
    maxEstimatedTokens: 100,
  });
  assert.equal(result.history.length, 0);
  assert.equal(result.documentMaxChars, 0);
});
