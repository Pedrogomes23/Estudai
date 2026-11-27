/** Cliente da API REST do Estudaí! (cookies de sessão HttpOnly, mesma origem). */

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function toApiError(res) {
  const body = await res.json().catch(() => null);
  const error = body?.error ?? {};
  return new ApiError(
    res.status,
    error.code ?? 'ERROR',
    error.message ?? 'Algo deu errado. Tente de novo.',
    error.fields,
  );
}

async function send(method, url, { json, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (form) {
    init.body = form;
  } else if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.',
    );
  }
}

async function request(method, url, options) {
  const res = await send(method, url, options);
  if (!res.ok) throw await toApiError(res);
  return res.status === 204 ? null : res.json();
}

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  auth: {
    me: () => request('GET', '/api/auth/me').then((r) => r.user),
    login: (data) => request('POST', '/api/auth/login', { json: data }).then((r) => r.user),
    register: (data) => request('POST', '/api/auth/register', { json: data }).then((r) => r.user),
    logout: () => request('POST', '/api/auth/logout'),
    forgotPassword: (data) => request('POST', '/api/auth/forgot-password', { json: data }),
    validateResetToken: (token) =>
      request('GET', `/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`),
    resetPassword: (data) => request('POST', '/api/auth/reset-password', { json: data }),
    validateEmailVerification: (token) =>
      request('GET', `/api/auth/verify-email/validate?token=${encodeURIComponent(token)}`),
    verifyEmail: (token) => request('POST', '/api/auth/verify-email', { json: { token } }),
    resendVerification: (data) => request('POST', '/api/auth/resend-verification', { json: data }),
  },
  materials: {
    list: (filters) => request('GET', `/api/materials${query(filters)}`),
    disciplines: () => request('GET', '/api/materials/disciplines').then((r) => r.items),
    myDownloads: () => request('GET', '/api/materials/downloads/mine').then((r) => r.items),
    create: (form) => request('POST', '/api/materials', { form }).then((r) => r.item),
    remove: (id) => request('DELETE', `/api/materials/${id}`),
    async download(id) {
      const res = await send('GET', `/api/materials/${id}/download`);
      if (!res.ok) throw await toApiError(res);
      return res.blob();
    },
  },
  communities: {
    list: (filters) => request('GET', `/api/communities${query(filters)}`).then((r) => r.items),
    get: (id) => request('GET', `/api/communities/${id}`).then((r) => r.item),
    create: (data) => request('POST', '/api/communities', { json: data }).then((r) => r.item),
    members: (id) => request('GET', `/api/communities/${id}/members`).then((r) => r.items),
    messages: (id) => request('GET', `/api/communities/${id}/messages`).then((r) => r.items),
    send: (id, body) =>
      request('POST', `/api/communities/${id}/messages`, {
        json: { body },
      }).then((r) => r.item),

    createAttachmentUpload: (id, file) =>
      request('POST', `/api/communities/${id}/attachments/upload-url`, {
        json: {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        },
      }),

    completeAttachmentUpload: (id, data) =>
      request('POST', `/api/communities/${id}/attachments/complete`, {
        json: data,
      }).then((r) => r.item),

    removeMessage: (id, messageId) => request('DELETE', `/api/communities/${id}/messages/${messageId}`),

    join: (id) => request('PUT', `/api/communities/${id}/membership`).then((r) => r.item),

    leave: (id) => request('DELETE', `/api/communities/${id}/membership`).then((r) => r.item),

    remove: (id) => request('DELETE', `/api/communities/${id}`),
  },
  profile: {
    me: () => request('GET', '/api/profile/me'),
    update: (data) => request('PATCH', '/api/profile/me', { json: data }).then((r) => r.user),
    activities: () => request('GET', '/api/profile/activities').then((r) => r.items),
    uploadAvatar: (file) => {
      const form = new FormData();
      form.append('avatar', file);
      return request('POST', '/api/profile/me/avatar', { form });
    },
    removeAvatar: () => request('DELETE', '/api/profile/me/avatar'),
  },
  notifications: {
    list: () => request('GET', '/api/notifications'),
    release: (id) => request('GET', `/api/notifications/${id}/release`).then((r) => r.release),
    markRead: (id) => request('POST', `/api/notifications/${id}/read`),
    markAllRead: () => request('POST', '/api/notifications/read-all'),
  },
  feedback: {
    send: (data) => request('POST', '/api/feedback', { json: data }).then((r) => r.item),
    mine: () => request('GET', '/api/feedback/mine').then((r) => r.items),
  },
  admin: {
    stats: () => request('GET', '/api/admin/stats'),
    users: () => request('GET', '/api/admin/users').then((r) => r.items),
    announce: (title, body) =>
      request('POST', '/api/admin/announcements', { json: { title, body } }),
    listAnnouncements: () => request('GET', '/api/admin/announcements').then((r) => r.items),
    deleteAnnouncement: (id) => request('DELETE', `/api/admin/announcements/${id}`),
  },
  ai: {
    listConversations: () => request('GET', '/api/ai/conversations'),
    createConversation: (title) => request('POST', '/api/ai/conversations', { json: title ? { title } : {} }),
    getConversation: (id) => request('GET', `/api/ai/conversations/${id}`),
    sendMessage: (id, payload) => {
      const body = typeof payload === 'string' ? { content: payload } : payload;
      return request('POST', `/api/ai/conversations/${id}/messages`, { json: body });
    },
    extractText: (form) => request('POST', '/api/ai/extract-text', { form }),
    extractFromMaterial: (materialId) =>
      request('POST', '/api/ai/extract-material', { json: { materialId } }),
    deleteConversation: (id) => request('DELETE', `/api/ai/conversations/${id}`),
    limits: () => request('GET', '/api/ai/limits'),
  },
};
