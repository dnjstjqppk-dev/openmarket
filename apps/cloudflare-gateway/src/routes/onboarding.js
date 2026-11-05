// apps/cloudflare-gateway/src/routes/onboarding.js
// Seller onboarding (audit item O05): public application -> private KYB documents -> submit -> operator review.
//   POST /api/v1/partner-applications                         public: create seller account + PENDING partner
//   GET  /api/v1/partner/application                          applicant: status, documents, what is missing
//   POST /api/v1/partner/application/documents                applicant: attach an uploaded (private) file
//   POST /api/v1/partner/application/submit                   applicant: send for review
//   GET  /api/v1/admin/partner-applications                   operator: review queue
//   POST /api/v1/admin/partner-applications/:id/review        operator: APPROVE | REJECT | REQUEST_RESUBMIT

import { requireAuth, requireAdmin, issueToken } from '../lib/auth.js';
import { json, readJson, bad, conflict, notFound, str } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { auditStatement } from '../lib/ledger.js';
import { hashPassword } from '../utils/crypto-auth.js';
import { normalizeBrn } from './business.js';
import { validatePassword } from './auth.js';
import { logPiiView } from '../services/privacy.js';

export function validateKoreanBrnChecksum(rawBrn) {
  const clean = String(rawBrn || '').replace(/[^0-9]/g, '');
  if (clean.length !== 10) return { valid: false, reason: '사업자등록번호는 10자리 숫자여야 합니다.' };
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(clean[i]) * weights[i];
  }
  sum += Math.floor((Number(clean[8]) * 5) / 10);
  const remainder = (10 - (sum % 10)) % 10;
  const valid = remainder === Number(clean[9]);
  return {
    valid,
    clean,
    formatted: clean.slice(0, 3) + '-' + clean.slice(3, 5) + '-' + clean.slice(5),
    reason: valid ? '국세청 검증 규격 일치' : '사업자등록번호 체크섬(검증번호) 불일치'
  };
}

export const REQUIRED_DOCS = ['BUSINESS_REGISTRATION', 'MAIL_ORDER_REGISTRATION', 'BANK_ACCOUNT_COPY'];
const DOC_TYPES = [...REQUIRED_DOCS, 'OTHER'];
const SELLER_TERMS_VERSION = 'seller-terms-draft-2026-11';
const EDITABLE = ['DRAFT', 'RESUBMIT_REQUIRED'];

function requiredDocsFor(partner) {
  // A seller exempt from 통신판매업 신고 (e.g. 간이과세자 일부) has no registration certificate to upload.
  return partner.mail_order_exempt_reason ? REQUIRED_DOCS.filter((d) => d !== 'MAIL_ORDER_REGISTRATION') : REQUIRED_DOCS;
}

async function applicationView(env, partner) {
  const { results: docs } = await env.DB.prepare(
    `SELECT d.id, d.doc_type, d.status, d.review_note, d.created_at, o.original_name, o.content_type, o.byte_size, o.id AS file_id
     FROM partner_kyb_documents d JOIN storage_objects o ON o.id = d.storage_object_id WHERE d.partner_id = ? ORDER BY d.created_at DESC`
  ).bind(partner.id).all();
  const live = docs.filter((d) => d.status !== 'SUPERSEDED' && d.status !== 'REJECTED');
  const required = requiredDocsFor(partner);
  return {
    partner_id: partner.id, business_name: partner.business_name, business_reg_number: partner.business_reg_number,
    representative_name: partner.representative_name, mail_order_reg_number: partner.mail_order_reg_number, mail_order_exempt_reason: partner.mail_order_exempt_reason,
    status: partner.status, kyc_status: partner.kyc_status, review_note: partner.review_note,
    applied_at: partner.applied_at, submitted_at: partner.submitted_at, reviewed_at: partner.reviewed_at,
    required_documents: required, missing_documents: required.filter((t) => !live.some((d) => d.doc_type === t)),
    documents: docs, editable: EDITABLE.includes(partner.kyc_status)
  };
}

export async function handleOnboardingRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (p === '/api/v1/onboarding/validate-business' && request.method === 'POST') {
    const b = await readJson(request);
    const brn = String(b.business_reg_number || b.registration_number || b.brn || '').trim();
    const chk = validateKoreanBrnChecksum(brn);
    if (!chk.valid) {
      return json(corsHeaders, { success: false, valid: false, reason: chk.reason }, 400);
    }
    if (env.NTS_API_KEY) {
      try {
        const ntsRes = await fetch('https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=' + encodeURIComponent(env.NTS_API_KEY), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ b_no: [chk.clean] })
        });
        const ntsData = await ntsRes.json().catch(() => ({}));
        const item = ntsData && ntsData.data && ntsData.data[0];
        if (item && item.b_stt) {
          const isAlive = item.b_stt_cd === '01';
          return json(corsHeaders, {
            success: true,
            valid: isAlive,
            business_status: item.b_stt,
            tax_type: item.tax_type,
            verification: 'NTS_OPEN_API',
            formatted: chk.formatted
          });
        }
      } catch (_) {}
    }
    return json(corsHeaders, {
      success: true,
      valid: true,
      // Only the check digit was verified. Status / tax type are unknown until the NTS lookup is configured or answers.
      business_status: null,
      tax_type: null,
      verification: 'CHECKSUM_ONLY',
      message: '사업자등록번호 형식(검증번호)만 확인했습니다. 휴·폐업 여부는 국세청 조회가 연동되지 않아 확인하지 못했습니다.',
      formatted: chk.formatted
    });
  }

  const isPublic = p === '/api/v1/partner-applications';
  const isApplicant = p === '/api/v1/partner/application' || p.startsWith('/api/v1/partner/application/');
  const isAdmin = p === '/api/v1/admin/partner-applications' || p.startsWith('/api/v1/admin/partner-applications/');
  if (!isPublic && !isApplicant && !isAdmin) return null;

  if (isPublic && request.method === 'POST') {
    const b = await readJson(request);
    const email = str(b.email, { field: '이메일', max: 254, required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
    validatePassword(b.password);
    const contactName = str(b.contact_name || b.full_name, { field: '담당자명', max: 50, required: true });
    const phone = str(b.phone, { field: '담당자 연락처', max: 20, required: true });
    if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(phone)) throw bad('INVALID_PHONE', '연락처 형식이 올바르지 않습니다.');
    const businessName = str(b.business_name, { field: '상호', max: 100, required: true });
    const representative = str(b.representative_name, { field: '대표자명', max: 50, required: true });
    const brn = normalizeBrn(b.business_reg_number);
    const mailOrder = b.mail_order_reg_number ? str(b.mail_order_reg_number, { field: '통신판매업 신고번호', max: 50 }) : null;
    const exempt = b.mail_order_exempt_reason ? str(b.mail_order_exempt_reason, { field: '통신판매업 신고 면제 사유', max: 200 }) : null;
    if (!mailOrder && !exempt) throw bad('MAIL_ORDER_REQUIRED', '통신판매업 신고번호를 입력하거나 신고 면제 사유를 적어 주세요.');
    const bankCode = str(b.bank_code, { field: '은행 코드', max: 10, required: true });
    const account = str(b.bank_account_number, { field: '정산 계좌번호', max: 30, required: true }).replace(/[^\d-]/g, '');
    if (account.replace(/\D/g, '').length < 8) throw bad('INVALID_ACCOUNT', '계좌번호를 확인해 주세요.');
    const holder = str(b.bank_account_holder, { field: '예금주', max: 50, required: true });
    const csPhone = str(b.customer_service_phone, { field: '고객센터 번호', max: 20, required: true });
    const returnAddr = str(b.return_shipping_address, { field: '반품 주소', max: 300, required: true });
    if (b.agree_seller_terms !== true || b.agree_privacy !== true) throw bad('CONSENT_REQUIRED', '판매자 이용약관과 개인정보 수집·이용에 동의해 주세요.');

    if (await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(email).first()) throw conflict('EMAIL_TAKEN', '이미 등록된 이메일입니다.');
    if (await env.DB.prepare('SELECT id FROM partners WHERE business_reg_number = ?').bind(brn).first()) throw conflict('BRN_EXISTS', '이미 입점 신청된 사업자등록번호입니다.');
    const userId = newId('usr');
    const partnerId = newId('pt');
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id, email, password_hash, full_name, phone, role, is_active) VALUES (?, ?, ?, ?, ?, 'ROLE_PARTNER', 1)")
          .bind(userId, email, await hashPassword(b.password), contactName, phone),
        // commission_rate_bps stays NULL until the operator sets it at approval; the application cannot pick its own rate.
        env.DB.prepare(
          `INSERT INTO partners (id, owner_user_id, business_name, business_reg_number, representative_name, mail_order_reg_number, mail_order_exempt_reason,
                                 bank_code, bank_account_number, bank_account_holder, customer_service_phone, return_shipping_address,
                                 status, kyc_status, sales_model, payout_account_verified, applied_at, seller_terms_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'DRAFT', 'MARKETPLACE', 0, CURRENT_TIMESTAMP, ?)`
        ).bind(partnerId, userId, businessName, brn, representative, mailOrder, exempt, bankCode, account, holder, csPhone, returnAddr, SELLER_TERMS_VERSION)
      ]);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('APPLICATION_EXISTS', '이미 등록된 이메일 또는 사업자등록번호입니다.');
      throw e;
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    const partner = await env.DB.prepare('SELECT id, business_name, status, sales_model FROM partners WHERE id = ?').bind(partnerId).first();
    const token = await issueToken(env, user, partner);
    return json(corsHeaders, {
      success: true, message: '입점 신청서가 저장되었습니다. 서류를 올리고 심사를 요청해 주세요.',
      data: { token, partner, required_documents: REQUIRED_DOCS }
    }, 201);
  }

  if (isApplicant) {
    const me = await requireAuth(request, env, ['ROLE_PARTNER']);
    if (!me.partner) throw notFound('입점 신청 정보를 찾을 수 없습니다.');
    const partner = me.partner;

    if (p === '/api/v1/partner/application' && request.method === 'GET') {
      return json(corsHeaders, { success: true, data: await applicationView(env, partner) });
    }

    if (p === '/api/v1/partner/application/documents' && request.method === 'POST') {
      if (!EDITABLE.includes(partner.kyc_status)) throw conflict('APPLICATION_LOCKED', '심사 중이거나 심사가 끝난 신청서는 서류를 바꿀 수 없습니다.');
      const b = await readJson(request);
      const docType = String(b.doc_type || '');
      if (!DOC_TYPES.includes(docType)) throw bad('INVALID_DOC_TYPE', '서류 종류가 올바르지 않습니다.');
      const fileId = str(b.file_id, { field: 'file_id', max: 200, required: true });
      const obj = await env.DB.prepare('SELECT id, uploader_id, visibility FROM storage_objects WHERE id = ?').bind(fileId).first();
      // Only the applicant's own PRIVATE upload can be attached (prevents pointing at a public or someone else's file).
      if (!obj || obj.uploader_id !== me.userId || obj.visibility !== 'PRIVATE') throw bad('INVALID_FILE', '본인이 입점 서류(kyb)로 업로드한 파일만 첨부할 수 있습니다.');
      const docId = newId('kyb');
      const st = [];
      if (docType !== 'OTHER') {
        st.push(env.DB.prepare("UPDATE partner_kyb_documents SET status = 'SUPERSEDED' WHERE partner_id = ? AND doc_type = ? AND status = 'SUBMITTED'").bind(partner.id, docType));
      }
      st.push(env.DB.prepare('INSERT INTO partner_kyb_documents (id, partner_id, doc_type, storage_object_id) VALUES (?, ?, ?, ?)').bind(docId, partner.id, docType, obj.id));
      await env.DB.batch(st);
      return json(corsHeaders, { success: true, data: await applicationView(env, partner) }, 201);
    }

    if (p === '/api/v1/partner/application/submit' && request.method === 'POST') {
      if (!EDITABLE.includes(partner.kyc_status)) throw conflict('APPLICATION_LOCKED', '이미 심사 요청된 신청서입니다.');
      const view = await applicationView(env, partner);
      if (view.missing_documents.length) throw conflict('DOCUMENTS_MISSING', '필수 서류가 빠져 있습니다.', { missing_documents: view.missing_documents });
      const r = await env.DB.prepare("UPDATE partners SET kyc_status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND kyc_status IN ('DRAFT','RESUBMIT_REQUIRED')").bind(partner.id).run();
      if (r.meta.changes !== 1) throw conflict('APPLICATION_LOCKED', '이미 심사 요청된 신청서입니다.');
      const fresh = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(partner.id).first();
      return json(corsHeaders, { success: true, message: '심사 요청이 접수되었습니다.', data: await applicationView(env, fresh) });
    }
    return null;
  }

  // ---- operator review ----
  const admin = await requireAdmin(request, env);

  if (p === '/api/v1/admin/partner-applications' && request.method === 'GET') {
    const status = url.searchParams.get('kyc_status') || 'SUBMITTED';
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.email AS contact_email, u.full_name AS contact_name, u.phone AS contact_phone FROM partners p JOIN users u ON u.id = p.owner_user_id
       WHERE p.applied_at IS NOT NULL AND (? = 'ALL' OR p.kyc_status = ?) ORDER BY COALESCE(p.submitted_at, p.applied_at) LIMIT 200`
    ).bind(status, status).all();
    const out = [];
    for (const pt of results) {
      const v = await applicationView(env, pt);
      out.push({ ...v, contact_email: pt.contact_email, contact_name: pt.contact_name, contact_phone: pt.contact_phone,
        bank_code: pt.bank_code, bank_account_number: pt.bank_account_number, bank_account_holder: pt.bank_account_holder,
        customer_service_phone: pt.customer_service_phone, return_shipping_address: pt.return_shipping_address });
    }
    await logPiiView(env, admin, 'admin.partner-applications', 'user', results.map((r) => r.owner_user_id), 'contact,bank_account,representative_name', request);
    return json(corsHeaders, { success: true, count: out.length, data: out });
  }

  const rvM = p.match(/^\/api\/v1\/admin\/partner-applications\/([^/]+)\/review$/);
  if (rvM && request.method === 'POST') {
    const pt = await env.DB.prepare('SELECT * FROM partners WHERE id = ? AND applied_at IS NOT NULL').bind(rvM[1]).first();
    if (!pt) throw notFound('입점 신청을 찾을 수 없습니다.');
    if (pt.kyc_status !== 'SUBMITTED') throw conflict('NOT_SUBMITTED', `심사 요청 상태의 신청만 처리할 수 있습니다. (현재: ${pt.kyc_status})`);
    const b = await readJson(request);
    const decision = String(b.decision || '');
    const note = b.note ? str(b.note, { field: '심사 메모', max: 1000 }) : null;
    const view = await applicationView(env, pt);
    const before = { status: pt.status, kyc_status: pt.kyc_status };
    const st = [];

    if (decision === 'APPROVE') {
      if (view.missing_documents.length) throw conflict('DOCUMENTS_MISSING', '필수 서류가 없습니다.', { missing_documents: view.missing_documents });
      if (b.confirm_documents_checked !== true) throw bad('CONFIRM_REQUIRED', '제출 서류의 원본 대조를 확인해 주세요.');
      const brnEvidence = str(b.business_status_evidence, { field: '사업자 상태 확인 근거(국세청 조회 결과 등)', max: 300, required: true });
      const rate = Number(b.commission_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 50) throw bad('INVALID_COMMISSION', '수수료율은 0~50% 사이로 입력해 주세요.');
      const bps = Math.round(rate * 100);
      st.push(env.DB.prepare(
        `UPDATE partners SET status = 'APPROVED', kyc_status = 'APPROVED', commission_rate = ?, commission_rate_bps = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?,
                review_note = ?, kyc_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND kyc_status = 'SUBMITTED'`
      ).bind(bps / 100, bps, admin.userId, note, `사업자 상태 확인: ${brnEvidence}`, pt.id));
      st.push(env.DB.prepare("UPDATE partner_kyb_documents SET status = 'ACCEPTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE partner_id = ? AND status = 'SUBMITTED'").bind(admin.userId, pt.id));
      st.push(auditStatement(env, admin, { action: 'PARTNER_APPLICATION_APPROVE', targetType: 'partner', targetId: pt.id, before, after: { commission_bps: bps, brnEvidence, note }, request }));
    } else if (decision === 'REJECT' || decision === 'REQUEST_RESUBMIT') {
      if (!note) throw bad('NOTE_REQUIRED', '신청자에게 보여줄 사유를 입력해 주세요.');
      const rejectedDocs = Array.isArray(b.rejected_document_ids) ? b.rejected_document_ids.map(String) : [];
      if (decision === 'REJECT') {
        st.push(env.DB.prepare("UPDATE partners SET status = 'REJECTED', kyc_status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND kyc_status = 'SUBMITTED'").bind(admin.userId, note, pt.id));
      } else {
        st.push(env.DB.prepare("UPDATE partners SET kyc_status = 'RESUBMIT_REQUIRED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND kyc_status = 'SUBMITTED'").bind(admin.userId, note, pt.id));
      }
      for (const id of rejectedDocs) {
        st.push(env.DB.prepare("UPDATE partner_kyb_documents SET status = 'REJECTED', review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND partner_id = ? AND status = 'SUBMITTED'").bind(note, admin.userId, id, pt.id));
      }
      st.push(auditStatement(env, admin, { action: `PARTNER_APPLICATION_${decision}`, targetType: 'partner', targetId: pt.id, before, after: { note, rejectedDocs }, request }));
    } else {
      throw bad('INVALID_DECISION', 'decision 은 APPROVE, REJECT, REQUEST_RESUBMIT 중 하나여야 합니다.');
    }
    const r = await env.DB.batch(st);
    if (r[0].meta.changes !== 1) throw conflict('NOT_SUBMITTED', '다른 관리자가 이미 처리했습니다.');
    const fresh = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(pt.id).first();
    return json(corsHeaders, {
      success: true, data: await applicationView(env, fresh),
      next_step: decision === 'APPROVE' ? '정산 계좌 실명 확인(POST /api/v1/admin/partners/:id/payout-account) 전에는 지급이 차단됩니다.' : null
    });
  }

  return null;
}
