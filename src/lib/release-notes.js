/**
 * Novidades que aparecem para os usuários depois de um deploy.
 *
 * COMO USAR (antes de cada deploy que tenha novidade para os usuários):
 *   1. Adicione uma entrada NOVA no TOPO da lista RELEASES abaixo.
 *   2. Use um `id` que nunca foi usado (a data + um nome curto funciona bem).
 *   3. Faça o commit e o deploy normalmente.
 *
 * O que cada campo faz:
 *   - id:          identificador único. É ele que impede o aviso de ser enviado duas vezes.
 *   - summary:     frase curta que aparece no sininho (1 linha ou 2, no máximo ~140 letras).
 *   - title:       título do balão que abre ao clicar no aviso.
 *   - description: parágrafo curto do balão (opcional).
 *   - items:       lista do que mudou, uma frase por item (opcional).
 *
 * Deploy sem entrada nova aqui = nenhum aviso é enviado (correções pequenas não incomodam ninguém).
 * Aviso manual do administrador (painel de avisos) é outra coisa e não passa por aqui.
 *
 * Exemplo (descomente e ajuste):
 *
 *   {
 *     id: '2026-12-01-envio-de-videos',
 *     summary: 'Agora você pode enviar vídeos nas comunidades.',
 *     title: 'Envio de vídeos',
 *     description: 'Compartilhe aulas e resumos em vídeo direto no chat das comunidades.',
 *     items: [
 *       'Envie vídeos de até 25 MB no chat.',
 *       'Os vídeos ficam disponíveis para todos os membros da comunidade.',
 *     ],
 *   },
 */
export const RELEASES = [
  // A mais nova fica no topo.
];

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

/** Normaliza uma entrada (limites de tamanho) ou devolve null se estiver incompleta. */
export function normalizeRelease(raw) {
  const id = clean(raw?.id, 80);
  const summary = clean(raw?.summary, 200);
  if (!id || !summary) return null;
  return {
    id,
    summary,
    title: clean(raw.title, 120) || 'Atualização no Estudaí!',
    description: clean(raw.description, 800),
    items: Array.isArray(raw.items)
      ? raw.items.map((item) => clean(item, 240)).filter(Boolean).slice(0, 12)
      : [],
  };
}

export function findRelease(id, releases = RELEASES) {
  const wanted = clean(id, 80);
  if (!wanted) return null;
  const raw = releases.find((r) => clean(r?.id, 80) === wanted);
  return raw ? normalizeRelease(raw) : null;
}

export function latestRelease(releases = RELEASES) {
  for (const raw of releases) {
    const release = normalizeRelease(raw);
    if (release) return release;
  }
  return null;
}

export const RELEASE_LINK_PREFIX = 'release:';
