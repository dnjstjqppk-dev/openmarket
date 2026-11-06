// apps/cloudflare-gateway/src/lib/email.js
// Outbound mail via the Resend HTTP API (no SDK dependency).
// Fail-closed: without RESEND_API_KEY + EMAIL_FROM nothing is sent and callers
// keep their honest NOT_INTEGRATED messaging. EMAIL_FROM must be a domain the
// operator verified in Resend (DNS), otherwise the provider rejects the send.

export function emailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && /.+@.+\..+/.test(String(env.EMAIL_FROM || '')));
}

export function storefrontBaseUrl(env) {
  return String(env.PUBLIC_STOREFRONT_URL || 'https://olmoa.com').replace(/\/+$/, '');
}

/** Throws on provider failure so the caller can answer 503 (retryable), never a fake "sent". */
export async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html })
  });
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
    throw new Error(`EMAIL_SEND_FAILED ${res.status} ${detail}`.trim());
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function resetPasswordMail(env, link) {
  const safe = esc(link);
  return {
    subject: '[OLMOA] 비밀번호 재설정 안내',
    html: `<p>비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 30분 안에 새 비밀번호를 설정해 주세요.</p><p><a href="${safe}">비밀번호 재설정하기</a></p><p>본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>`
  };
}

export function verifyEmailMail(env, link) {
  const safe = esc(link);
  return {
    subject: '[OLMOA] 이메일 주소 인증',
    html: `<p>OLMOA 가입을 환영합니다. 아래 버튼을 눌러 이메일 인증을 완료해 주세요. (24시간 유효)</p><p><a href="${safe}">이메일 인증하기</a></p>`
  };
}
