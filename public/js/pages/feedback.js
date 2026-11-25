import { ApiError, api } from '../lib/api.js';
import { $, escapeHtml } from '../lib/dom.js';
import { initSidebar, setSidebarUser } from '../lib/sidebar.js';

const MAX_MESSAGE = 1000;
const MIN_MESSAGE = 10;
const RATING_TEXT = {
  1: 'Ruim',
  2: 'Poderia ser melhor',
  3: 'Ok',
  4: 'Bom',
  5: 'Excelente',
};
const FIELDS = ['rating', 'category', 'area', 'message'];

const form = $('f-feedback');

/* ---------- Utilidades ---------- */

let toastTimer;
function say(text) {
  const box = $('msg');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 3200);
}

/** Sessão expirada volta para o login; qualquer outro erro vira aviso na tela. */
function handleError(err, fallback) {
  if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
  say(err instanceof ApiError ? err.message : fallback);
}

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

/* ---------- Formulário ---------- */

const rating = () => form.querySelector('input[name="rating"]:checked')?.value;
const category = () => form.querySelector('input[name="category"]:checked')?.value;

/** Mostra (ou limpa, se `message` vazio) o erro de um campo. Retorna true quando o campo está válido. */
function fail(field, message) {
  $(`${field}-e`).textContent = message || '';
  const target = field === 'rating' || field === 'category' ? null : $(field);
  if (target) {
    if (message) target.setAttribute('aria-invalid', 'true');
    else target.removeAttribute('aria-invalid');
  }
  return !message;
}

function validate() {
  const text = $('message').value.trim();
  const results = [
    fail('rating', rating() ? '' : 'Escolha uma nota de 1 a 5 estrelas.'),
    fail('category', category() ? '' : 'Escolha o tipo de feedback.'),
    fail('area', $('area').value ? '' : 'Escolha a parte do Estudaí! sobre a qual você quer falar.'),
    fail(
      'message',
      text.length >= MIN_MESSAGE ? '' : `Conte um pouco mais (pelo menos ${MIN_MESSAGE} caracteres).`,
    ),
  ];
  if (results.every(Boolean)) return true;
  // Leva o foco para o primeiro campo com problema.
  const firstInvalid = FIELDS.find((f) => $(`${f}-e`).textContent);
  const focusTarget = {
    rating: () => form.querySelector('input[name="rating"]'),
    category: () => form.querySelector('input[name="category"]'),
    area: () => $('area'),
    message: () => $('message'),
  }[firstInvalid];
  focusTarget?.().focus();
  return false;
}

function updateRatingText() {
  const value = rating();
  const label = $('rate-text');
  label.textContent = value ? `${value} de 5 – ${RATING_TEXT[value]}` : 'Toque nas estrelas para avaliar';
  label.classList.toggle('set', Boolean(value));
}

function updateCount() {
  const length = $('message').value.length;
  const counter = $('message-count');
  counter.textContent = `${length}/${MAX_MESSAGE}`;
  counter.classList.toggle('warn', length >= MAX_MESSAGE - 50);
}

function setBusy(busy) {
  const button = $('send');
  button.disabled = busy;
  button.textContent = busy ? 'Enviando…' : 'Enviar feedback';
}

function showThanks() {
  form.hidden = true;
  $('thanks').hidden = false;
  $('thanks').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  form.reset();
  for (const field of FIELDS) fail(field, '');
  $('form-e').textContent = '';
  updateRatingText();
  updateCount();
  $('thanks').hidden = true;
  form.hidden = false;
  form.querySelector('input[name="rating"]').focus();
}

async function submit(event) {
  event.preventDefault();
  $('form-e').textContent = '';
  if (!validate()) return;

  setBusy(true);
  try {
    const item = await api.feedback.send({
      rating: Number(rating()),
      category: category(),
      area: $('area').value,
      message: $('message').value.trim(),
      allowContact: $('contact').checked,
    });
    showThanks();
    prependMine(item);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    // Erros de campo vindos do servidor aparecem junto ao campo; os demais, acima do botão.
    const apiError = err instanceof ApiError ? err : null;
    const field = apiError?.fields && Object.keys(apiError.fields).find((key) => FIELDS.includes(key));
    if (field) fail(field, apiError.fields[field]);
    else $('form-e').textContent = apiError?.message ?? 'Não foi possível enviar. Tente de novo.';
  } finally {
    setBusy(false);
  }
}

/* ---------- Feedbacks já enviados ---------- */

const mine = [];

function renderMine() {
  $('mine').hidden = mine.length === 0;
  $('mine-list').innerHTML = mine
    .map((x) => {
      const filled = '★'.repeat(x.rating);
      const empty = '★'.repeat(5 - x.rating);
      return (
        `<article class="item">` +
        `<div class="top-row"><span class="stars-sm" role="img" aria-label="Nota ${x.rating} de 5">${filled}<i>${empty}</i></span>` +
        `<time datetime="${escapeHtml(x.createdAt)}">${escapeHtml(formatDate(x.createdAt))}</time></div>` +
        `<div class="tags"><span class="tag">${escapeHtml(x.category)}</span><span class="tag alt">${escapeHtml(x.area)}</span></div>` +
        `<p>${escapeHtml(x.message)}</p></article>`
      );
    })
    .join('');
}

function prependMine(item) {
  mine.unshift(item);
  renderMine();
}

async function loadMine() {
  try {
    mine.push(...(await api.feedback.mine()));
    renderMine();
  } catch (err) {
    handleError(err, 'Não foi possível carregar seus feedbacks anteriores.');
  }
}

/* ---------- Estrutura da página ---------- */

async function logout(event) {
  event.preventDefault();
  try {
    await api.auth.logout();
  } finally {
    location.replace('index.html');
  }
}

function bindEvents() {
  form.addEventListener('submit', submit);
  form.addEventListener('change', (event) => {
    if (event.target.name === 'rating') {
      updateRatingText();
      fail('rating', '');
    }
    if (event.target.name === 'category') fail('category', '');
    if (event.target.id === 'area') fail('area', '');
  });
  $('message').addEventListener('input', () => {
    updateCount();
    if ($('message').value.trim().length >= MIN_MESSAGE) fail('message', '');
  });
  $('again').addEventListener('click', resetForm);
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-logout]')) logout(event);
  });
}

async function start() {
  try {
    initSidebar({ active: 'settings' });
    const me = await api.auth.me();
    // Admin não envia feedback — avaliações ficam no Dashboard.
    if (me.isAdmin) return location.replace('admin.html');
    setSidebarUser(me);
    $('hi').textContent = `Olá, ${me.name || 'estudante'}`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return location.replace('login.html');
    return say('Não foi possível conectar ao servidor.');
  }
  bindEvents();
  updateCount();
  loadMine();
}

start();
