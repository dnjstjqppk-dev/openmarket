// scripts/create-admin-sql.mjs
// Prints the SQL that creates the FIRST operator account (SUPER_ADMIN) for a fresh production D1.
// It never connects to any database: review the output, then apply it yourself (approval required), e.g.
//   ADMIN_EMAIL=ops@example.com ADMIN_NAME="홍길동" ADMIN_PASSWORD='…' node scripts/create-admin-sql.mjs > admin.sql
//   npx wrangler d1 execute openmarket-db --remote --file admin.sql
// Further operators are created in the console (계정 보안), not with this script.
// The password is read from the environment so it does not land in shell history as an argument.

import { hashPassword } from '../apps/cloudflare-gateway/src/utils/crypto-auth.js';
import { validatePassword } from '../apps/cloudflare-gateway/src/routes/auth.js';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const name = String(process.env.ADMIN_NAME || '').trim();
const password = String(process.env.ADMIN_PASSWORD || '');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error('ADMIN_EMAIL and ADMIN_NAME are required.');
  process.exit(1);
}
try {
  validatePassword(password);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const id = `usr_admin_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const hash = await hashPassword(password);
process.stdout.write(`-- First operator account (SUPER_ADMIN). 2FA must be enrolled at first login in production.
INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active, admin_role)
VALUES (${q(id)}, ${q(email)}, ${q(hash)}, ${q(name)}, '-', 'ROLE_ADMIN', 1, 'SUPER_ADMIN');
`);
