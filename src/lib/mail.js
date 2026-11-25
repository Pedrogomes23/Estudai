
import nodemailer from 'nodemailer';

/**
 * Envio de e-mails transacionais via SMTP (Nodemailer).
 * Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE,
 * SMTP_USER, SMTP_PASS e MAIL_FROM.
 */
export function createMailer(config) {
  const { host, port, secure, user, pass, from, enabled } = config.mail;

  if (!enabled) {
    return {
      enabled: false,
      async sendPasswordReset() {
        const err = new Error(
          'O envio de e-mail não está configurado. Defina SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS e MAIL_FROM nas variáveis de ambiente.',
        );
        err.code = 'MAIL_NOT_CONFIGURED';
        throw err;
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  return {
    enabled: true,

    async sendPasswordReset({ to, name, resetUrl }) {
      const safeName = name || 'estudante';

      const subject = 'Redefinição de senha da sua conta | Estudaí';

      const text = [
        `Olá, ${safeName}!`,
        '',
        'Recebemos uma solicitação para redefinir a senha da sua conta no Estudaí.',
        '',
        'Para cadastrar uma nova senha e voltar a acessar sua conta, utilize o endereço abaixo:',
        '',
        resetUrl,
        '',
        'Este link é válido por 15 minutos e pode ser utilizado apenas uma vez.',
        '',
        'Caso não tenha solicitado a redefinição, nenhuma ação é necessária. Basta ignorar esta mensagem. Sua senha atual permanecerá inalterada.',
        '',
        'Atenciosamente,',
        'Equipe Estudaí',
        'Plataforma de estudos e aprendizagem.',
      ].join('\n');

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#0a1230;font-family:Nunito,Segoe UI,Arial,sans-serif;color:#f1f3fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a1230;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#111c42;border:1px solid #26356a;border-radius:16px;padding:32px 28px;">
          <tr>
            <td>

              <p style="margin:0 0 8px;font-size:28px;font-weight:800;color:#fff;">
                Estud<span style="color:#fbb817;">aí!</span>
              </p>

              <h1 style="margin:16px 0 12px;font-size:22px;color:#fff;">
                Redefinição de senha
              </h1>

              <p style="margin:0 0 16px;line-height:1.6;color:#dfe3f2;">
                Olá, <strong>${escapeHtml(safeName)}</strong>!
              </p>

              <p style="margin:0 0 16px;line-height:1.6;color:#dfe3f2;">
                Recebemos uma solicitação para alterar a senha associada à sua conta no <strong>Estudaí</strong>.
              </p>

              <p style="margin:0 0 16px;line-height:1.6;color:#dfe3f2;">
                Para continuar utilizando a plataforma, clique no botão abaixo e cadastre uma nova senha:
              </p>

              <p style="margin:28px 0;text-align:center;">
                <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#fbb817;color:#10224f;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;font-size:16px;">
                  Redefinir minha senha
                </a>
              </p>

              <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#a9b3d1;">
                <strong>Importante:</strong> por segurança, este link expira em 15 minutos e só pode ser utilizado uma vez.
              </p>

              <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#a9b3d1;">
                Se o botão não funcionar, copie e cole o endereço abaixo no navegador:
                <br>
                <a href="${escapeHtml(resetUrl)}" style="color:#8479dc;word-break:break-all;">
                  ${escapeHtml(resetUrl)}
                </a>
              </p>

              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#a9b3d1;">
                <strong>Não foi você quem solicitou?</strong> Não se preocupe. Basta ignorar esta mensagem. Sua senha atual continuará a mesma e nenhuma alteração será realizada.
              </p>

              <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9b3d1;">
                Atenciosamente,<br>
                <strong style="color:#dfe3f2;">Equipe Estudaí</strong><br>
                Sua plataforma de estudos e aprendizagem.
              </p>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
