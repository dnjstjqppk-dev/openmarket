// apps/cloudflare-gateway/src/routes/social-auth.js
// Kakao OAuth 2.0 login (authorization-code flow), fail-closed without credentials.
//   GET /api/v1/auth/social/kakao/start             -> 302 to Kakao authorize (501 JSON when unconfigured)
//   GET /api/v1/auth/social/kakao/callback?code=... -> 302 to the storefront login page:
//        success: /login?social_token=<JWT>   failure: /login?social_error=<CODE>
// The account is found by (oauth_provider, oauth_subject) or created as ROLE_CUSTOMER.
// An e-mail already registered with a password is NEVER auto-linked (account takeover):
// the buyer signs in with the password instead (EMAIL_TAKEN).

import { issueToken } from '../lib/auth.js';
import { json } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { randomToken } from '../utils/crypto-auth.js';
import { storefrontBaseUrl } from '../lib/email.js';

const AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const USERINFO_URL = 'https://kapi.kakao.com/v2/user/me';

function kakaoConfig(env) {
  const key = env.KAKAO_REST_API_KEY;
  const redirect = env.KAKAO_REDIRECT_URI;
  if (!key || !redirect) return null;
  return { key, redirect, secret: env.KAKAO_CLIENT_SECRET || null };
}

function backToLogin(env, params) {
  const q = new URLSearchParams(params).toString();
  return Response.redirect(`${storefrontBaseUrl(env)}/login?${q}`, 302);
}

export async function handleSocialAuthRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/auth/social/')) return null;
  const p = url.pathname;

  if (p === '/api/v1/auth/social/kakao/start' && request.method === 'GET') {
    const c = kakaoConfig(env);
    if (!c) return json(corsHeaders, { success: false, code: 'SOCIAL_LOGIN_NOT_INTEGRATED', error: '소셜 로그인은 아직 제공되지 않습니다.' }, 501);
    // account_email scope is required: without an e-mail no account can be created (see below).
    const authorize = `${AUTHORIZE_URL}?${new URLSearchParams({ client_id: c.key, redirect_uri: c.redirect, response_type: 'code', scope: 'account_email' })}`;
    return Response.redirect(authorize, 302);
  }

  if (p === '/api/v1/auth/social/kakao/callback' && request.method === 'GET') {
    const c = kakaoConfig(env);
    if (!c) return json(corsHeaders, { success: false, code: 'SOCIAL_LOGIN_NOT_INTEGRATED', error: '소셜 로그인은 아직 제공되지 않습니다.' }, 501);
    const code = (url.searchParams.get('code') || '').trim();
    if (!code) return backToLogin(env, { social_error: 'OAUTH_DENIED' });
    try {
      // 1. authorization code -> access token (server to server; the code is never trusted by itself)
      const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: c.key, redirect_uri: c.redirect, code });
      if (c.secret) form.set('client_secret', c.secret);
      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form
      });
      if (!tokenRes.ok) return backToLogin(env, { social_error: 'OAUTH_EXCHANGE_FAILED' });
      const granted = await tokenRes.json();
      if (!granted || !granted.access_token) return backToLogin(env, { social_error: 'OAUTH_EXCHANGE_FAILED' });
      // 2. access token -> verified profile
      const meRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${granted.access_token}` } });
      if (!meRes.ok) return backToLogin(env, { social_error: 'OAUTH_PROFILE_FAILED' });
      const profile = await meRes.json();
      const subject = String((profile && profile.id) || '');
      const account = (profile && profile.kakao_account) || {};
      const email = typeof account.email === 'string' ? account.email.toLowerCase() : '';
      const nickname = (profile.properties && profile.properties.nickname) || '';
      if (!subject) return backToLogin(env, { social_error: 'OAUTH_PROFILE_FAILED' });
      if (!email) return backToLogin(env, { social_error: 'OAUTH_EMAIL_REQUIRED' });
      // 3. find-or-create (never auto-link a password account)
      const linked = await env.DB.prepare("SELECT * FROM users WHERE oauth_provider = 'kakao' AND oauth_subject = ?").bind(subject).first();
      let user = linked;
      if (!user) {
        const taken = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first();
        if (taken) return backToLogin(env, { social_error: 'EMAIL_TAKEN' });
        const id = newId('usr');
        await env.DB.prepare(
          `INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active, email_verified, oauth_provider, oauth_subject)
           VALUES (?, ?, ?, ?, '', 'ROLE_CUSTOMER', 1, ?, 'kakao', ?)`
        ).bind(id, email, `oauth:${randomToken(16)}`, String(nickname || '카카오 회원').slice(0, 50), account.is_email_verified === true ? 1 : 0, subject).run();
        user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      }
      if (Number(user.is_active) !== 1) return backToLogin(env, { social_error: 'ACCOUNT_DISABLED' });
      const jwt = await issueToken(env, user, null);
      return backToLogin(env, { social_token: jwt });
    } catch {
      return backToLogin(env, { social_error: 'OAUTH_PROVIDER_ERROR' });
    }
  }

  return null;
}
