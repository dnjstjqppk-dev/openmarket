import { requireAuth, authenticate } from '../lib/auth.js';
import { logPiiView } from '../services/privacy.js';
import { newId } from '../lib/ids.js';
import { bad, notFound, HttpError } from '../lib/http.js';
// apps/cloudflare-gateway/src/routes/storage.js
// OLMOA Cloudflare R2 & D1 Resilient Media Storage Engine

// Folders whose objects are never publicly served (seller KYB documents: business registration, bank account copy).
const PRIVATE_FOLDERS = new Set(['kyb']);
const PRIVATE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf'
];

export async function handleStorageRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/storage')) return null;

  // 1. File Upload (POST /api/v1/storage/upload)
  if (url.pathname === '/api/v1/storage/upload' && request.method === 'POST') {
    const uploader = await requireAuth(request, env);
    const contentType = request.headers.get('content-type') || '';
    let originalName = 'upload.png';
    let mimeType = 'image/png';
    let folder = 'products';
    let fileBase64 = '';
    let fileBytes = null;

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      fileBase64 = body.file_data || body.base64 || '';
      originalName = (body.file_name || 'upload.png').trim();
      mimeType = (body.content_type || 'image/png').trim().toLowerCase();
      folder = (body.folder || 'products').trim().toLowerCase();

      if (!fileBase64) throw bad('FILE_REQUIRED', 'Missing file_data in JSON body');

      // Strip data:image/...;base64, prefix if present
      if (fileBase64.includes(';base64,')) {
        const parts = fileBase64.split(';base64,');
        mimeType = parts[0].replace('data:', '') || mimeType;
        fileBase64 = parts[1];
      }

      // Convert base64 string to byte array
      const binaryString = atob(fileBase64);
      fileBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        fileBytes[i] = binaryString.charCodeAt(i);
      }
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null);
      if (!formData) throw bad('INVALID_FORM_DATA', 'Invalid multipart form data');
      const file = formData.get('file');
      folder = (formData.get('folder') || 'products').toString();
      if (!file || typeof file === 'string') throw bad('FILE_REQUIRED', 'No file found in multipart upload');

      originalName = file.name || 'upload.png';
      mimeType = file.type || 'image/png';
      const arrayBuffer = await file.arrayBuffer();
      fileBytes = new Uint8Array(arrayBuffer);

      // Convert to base64 for fallback storage
      let binary = '';
      for (let i = 0; i < fileBytes.byteLength; i++) {
        binary += String.fromCharCode(fileBytes[i]);
      }
      fileBase64 = btoa(binary);
    } else {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported Content-Type for upload');
    }

    folder = String(folder || 'products').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'products';
    if (!ALLOWED_CONTENT_TYPES.includes(mimeType)) {
      throw bad('INVALID_FILE_TYPE', `Invalid file type: ${mimeType}. Allowed types: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
    }

    const isPrivate = PRIVATE_FOLDERS.has(folder);
    if (isPrivate) {
      if (uploader.role !== 'ROLE_PARTNER') {
        return new Response(JSON.stringify({ success: false, code: 'FORBIDDEN', error: '입점 서류는 판매자 계정만 업로드할 수 있습니다.' }), { status: 403, headers: corsHeaders });
      }
      if (!PRIVATE_CONTENT_TYPES.includes(mimeType)) {
        return new Response(JSON.stringify({ success: false, code: 'INVALID_FILE_TYPE', error: '입점 서류는 PDF, JPG, PNG만 업로드할 수 있습니다.' }), { status: 400, headers: corsHeaders });
      }
    }

    const byteSize = fileBytes.byteLength;
    if (byteSize > 10 * 1024 * 1024) throw bad('FILE_TOO_LARGE', 'File size exceeds 10MB limit');

    const extMatch = originalName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : (mimeType === 'image/webp' ? 'webp' : 'png');
    const safeExt = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' })[mimeType];
    void ext;
    const fileId = `${folder}/${newId('obj')}.${safeExt}`;
    const publicUrl = `${url.origin}/api/v1/storage/file/${fileId}`;

    let storageBackend = 'D1_EMBEDDED';
    // 1. Cloudflare R2 Bucket Upload (if R2 binding is present)
    if (env.R2 || env.BUCKET) {
      try {
        const bucket = env.R2 || env.BUCKET;
        await bucket.put(fileId, fileBytes, {
          httpMetadata: { contentType: mimeType }
        });
        storageBackend = 'R2_BUCKET';
      } catch (err) {
        console.error('R2 upload fallback to D1:', err);
      }
    }

    // 2. Metadata & resilient base64 fallback in D1
    await env.DB.prepare(
      `INSERT INTO storage_objects (id, original_name, content_type, byte_size, folder, storage_backend, data_base64, public_url, uploader_id, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      fileId,
      originalName,
      mimeType,
      byteSize,
      folder,
      storageBackend,
      storageBackend === 'D1_EMBEDDED' ? fileBase64 : null,
      publicUrl,
      uploader.userId,
      isPrivate ? 'PRIVATE' : 'PUBLIC'
    ).run();

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA Media Storage',
      data: {
        file_id: fileId,
        original_name: originalName,
        content_type: mimeType,
        byte_size: byteSize,
        storage_backend: storageBackend,
        public_url: publicUrl,
        visibility: isPrivate ? 'PRIVATE' : 'PUBLIC',
        uploaded_at: new Date().toISOString()
      }
    }), { status: 201, headers: corsHeaders });
  }

  // 2. File Download & CDN Streaming (GET /api/v1/storage/file/*)
  if (url.pathname.startsWith('/api/v1/storage/file/') && request.method === 'GET') {
    const fileKey = url.pathname.replace('/api/v1/storage/file/', '').trim();
    if (!fileKey) throw bad('FILE_KEY_REQUIRED', 'Missing file key');

    const meta = await env.DB.prepare('SELECT id, uploader_id, visibility, folder FROM storage_objects WHERE id = ?').bind(fileKey).first();
    const isPrivate = (meta && meta.visibility === 'PRIVATE') || PRIVATE_FOLDERS.has(fileKey.split('/')[0]);
    let privateHeaders = null;
    if (isPrivate) {
      const viewer = await authenticate(request, env);
      const allowed = viewer && meta && (viewer.role === 'ROLE_ADMIN' || viewer.userId === meta.uploader_id);
      if (!allowed) {
        // Same answer for "missing" and "not yours": no existence oracle.
        throw notFound('File not found in storage');
      }
      if (viewer.role === 'ROLE_ADMIN') await logPiiView(env, viewer, 'admin.kyb-document', 'storage_object', [meta.id], 'kyb_document', request);
      privateHeaders = { ...corsHeaders, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' };
    }

    // A. Check R2 Bucket first
    if (env.R2 || env.BUCKET) {
      try {
        const bucket = env.R2 || env.BUCKET;
        const object = await bucket.get(fileKey);
        if (object) {
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          if (privateHeaders) {
            for (const [k, v] of Object.entries(privateHeaders)) headers.set(k, v);
          } else {
            headers.set('Cache-Control', 'public, max-age=31536000, immutable');
            headers.set('Access-Control-Allow-Origin', '*');
          }
          return new Response(object.body, { headers });
        }
      } catch (_) {}
    }

    // B. Check D1 Storage Object
    const row = await env.DB.prepare('SELECT * FROM storage_objects WHERE id = ?').bind(fileKey).first();
    if (!row || !row.data_base64) throw notFound('File not found in storage');

    const binaryString = atob(row.data_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    if (privateHeaders) {
      return new Response(bytes.buffer, { status: 200, headers: { ...privateHeaders, 'Content-Type': row.content_type, 'Content-Length': String(row.byte_size || bytes.byteLength) } });
    }
    return new Response(bytes.buffer, {
      status: 200,
      headers: {
        'Content-Type': row.content_type || 'image/png',
        'Content-Length': String(row.byte_size || bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  return null;
}

