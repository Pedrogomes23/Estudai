import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, parseId, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { isConstraintError } from '../db/index.js';

const CHAT_PAGE = 100;

const toApi = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  members: row.members,
  joined: Boolean(row.joined),
  mine: Boolean(row.mine),
});

// Mesmo formato de antes (sem milissegundos): 2026-11-13T17:54:52Z
const toIso = (date) => new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function communitiesRouter({ db, config }) {
  const router = Router();

  // $1 = id do usuário logado
  const select = `
    SELECT c.id, c.name::text AS name, c.description,
           (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id)::int AS members,
           EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1) AS joined,
           COALESCE(c.created_by = $1, false) AS mine
      FROM communities c`;

  // Filtros: q (texto), joined (participo), owned (administro), sort (recent|popular|name)
  const list = (me, q, joined, owned, sort) => {
    const order =
      sort === 'popular'
        ? `(SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) DESC, c.created_at DESC`
        : sort === 'name'
          ? `c.name::text ASC`
          : sort === 'recent'
            ? `c.created_at DESC, c.id DESC`
            : `c.is_official, CASE WHEN c.is_official THEN c.id ELSE -c.id END`;
    return db.all(
      `${select}
     WHERE ($2::text = '' OR position(lower(unaccent($2::text)) IN lower(unaccent(c.name::text || ' ' || c.description))) > 0)
       AND ($3::int = 0 OR EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = $1))
       AND ($4::int = 0 OR c.created_by = $1)
     ORDER BY ${order}`,
      [me, q, joined, owned],
    );
  };
  const byId = (id, me) => db.get(`${select} WHERE c.id = $2`, [me, id]);

  const join = (communityId, userId) =>
    db.run('INSERT INTO community_members (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      communityId,
      userId,
    ]);

  const listMembers = (communityId) =>
    db.all(
      `SELECT u.id, u.name, COALESCE(c.created_by = u.id, false) AS owner
         FROM community_members cm
         JOIN users u ON u.id = cm.user_id
         JOIN communities c ON c.id = cm.community_id
        WHERE cm.community_id = $1
        ORDER BY owner DESC, cm.joined_at ASC, u.id ASC`,
      [communityId],
    );
    
  const listMessages = (communityId) =>
    db.all(
      `SELECT * FROM (
       SELECT m.id, m.body, m.created_at, m.user_id, u.name AS author, m.attachment_url, m.attachment_type
         FROM community_messages m JOIN users u ON u.id = m.user_id
        WHERE m.community_id = $1
        ORDER BY m.id DESC LIMIT ${CHAT_PAGE}
     ) recent ORDER BY id ASC`,
      [communityId],
    );
  const messageById = (id, communityId) =>
    db.get(
      `SELECT m.id, m.body, m.created_at, m.user_id, u.name AS author, m.attachment_url, m.attachment_type
       FROM community_messages m JOIN users u ON u.id = m.user_id
      WHERE m.id = $1 AND m.community_id = $2`,
      [id, communityId],
    );

  const load = async (id, me) => {
    const row = await byId(id, me);
    if (!row) throw notFound('Comunidade não encontrada.');
    return row;
  };

  /** Só quem participa da comunidade lê e escreve no chat. */
  const loadAsMember = async (id, me) => {
    const row = await load(id, me);
    if (!row.joined) {
      throw forbidden('Entre na comunidade para ver o chat e os participantes.');
    }
    return row;
  };

  const toMessage = (row, me, isOwner) => ({
    id: row.id,
    body: row.body,
    createdAt: toIso(row.created_at),
    author: { id: row.user_id, name: row.author },
    mine: row.user_id === me,
    canDelete: row.user_id === me || isOwner,
    attachmentUrl: row.attachment_url || null,
    attachmentType: row.attachment_type || null,
  });

  const chatLimiter = config.rateLimit.enabled
    ? rateLimit({
        windowMs: 60_000,
        limit: 40,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Você está enviando mensagens rápido demais. Aguarde um instante.',
          },
        },
      })
    : (_req, _res, next) => next();

  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const joined = req.query.joined === '1' || req.query.joined === 'true' ? 1 : 0;
    const owned = req.query.owned === '1' || req.query.owned === 'true' ? 1 : 0;
    const sort = ['recent', 'popular', 'name', 'default'].includes(req.query.sort)
      ? req.query.sort
      : 'default';
    const items = (await list(req.user.id, q, joined, owned, sort)).map(toApi);
    res.json({ items });
  });

  router.post('/', async (req, res) => {
    const { name, description } = parse(schemas.community, req.body);
    let id;
    try {
      id = await db.transaction(async (tx) => {
        const created = await tx.get(
          'INSERT INTO communities (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
          [name, description, req.user.id],
        );
        // quem cria já é membro
        await tx.run('INSERT INTO community_members (community_id, user_id) VALUES ($1, $2)', [
          created.id,
          req.user.id,
        ]);
        return created.id;
      });
    } catch (err) {
      if (isConstraintError(err)) {
        throw conflict(
          'NAME_TAKEN',
          'Já existe uma comunidade com esse nome. Entre nela ou escolha outro nome.',
        );
      }
      throw err;
    }
    res.status(201).json({ item: toApi(await load(id, req.user.id)) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ item: toApi(await load(parseId(req.params.id), req.user.id)) });
  });

  router.put('/:id/membership', async (req, res) => {
    const id = parseId(req.params.id);
    await load(id, req.user.id);
    await join(id, req.user.id);
    res.json({ item: toApi(await load(id, req.user.id)) });
  });

  router.delete('/:id/membership', async (req, res) => {
    const id = parseId(req.params.id);
    await load(id, req.user.id);
    await db.run('DELETE FROM community_members WHERE community_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ item: toApi(await load(id, req.user.id)) });
  });

  router.delete('/:id', async (req, res) => {
    const row = await load(parseId(req.params.id), req.user.id);
    if (!row.mine && !req.user.is_admin) throw forbidden('Só quem criou a comunidade ou um administrador pode excluí-la.');
    await db.run('DELETE FROM communities WHERE id = $1', [row.id]);
    res.status(204).end();
  });

  /* ---- Participantes e chat (somente membros) ---- */

  router.get('/:id/members', async (req, res) => {
    const id = parseId(req.params.id);
    await loadAsMember(id, req.user.id);
    const items = (await listMembers(id)).map((m) => ({
      id: m.id,
      name: m.name,
      owner: Boolean(m.owner),
      me: m.id === req.user.id,
    }));
    res.json({ items });
  });

  router.get('/:id/messages', async (req, res) => {
    const id = parseId(req.params.id);
    const community = await loadAsMember(id, req.user.id);
    const rows = await listMessages(id);
    res.json({ items: rows.map((m) => toMessage(m, req.user.id, community.mine)) });
  });

  router.post('/:id/messages', chatLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    const community = await loadAsMember(id, req.user.id);
    
    // Aceita o texto e o arquivo
    const { body, attachmentUrl, attachmentType } = req.body;
    
    if (!body && !attachmentUrl) {
       return res.status(400).json({ error: { message: 'A mensagem ou o arquivo não pode estar vazio.' } });
    }

    const { id: messageId } = await db.get(
      'INSERT INTO community_messages (community_id, user_id, body, attachment_url, attachment_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [id, req.user.id, body || '', attachmentUrl || null, attachmentType || null],
    );
    const row = await messageById(messageId, id);
    res.status(201).json({ item: toMessage(row, req.user.id, community.mine) });
  });

  router.delete('/:id/messages/:messageId', async (req, res) => {
    const id = parseId(req.params.id);
    const community = await loadAsMember(id, req.user.id);
    const row = await messageById(parseId(req.params.messageId), id);
    if (!row) throw notFound('Mensagem não encontrada.');
    if (row.user_id !== req.user.id && !community.mine) {
      throw forbidden('Você só pode excluir as suas mensagens.');
    }
    await db.run('DELETE FROM community_messages WHERE id = $1', [row.id]);
    res.status(204).end();
  });

  return router;
}