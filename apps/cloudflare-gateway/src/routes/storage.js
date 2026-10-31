// apps/cloudflare-gateway/src/routes/storage.js
// OLMOA Cloudflare R2 & D1 Resilient Media Storage Engine

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf'
];

export async function handleStorageRoutes(request, url, env, corsHeaders) {
  if (!url.pathname.startsWith('/api/v1/storage')) return null;

  // 1. File Upload (POST /api/v1/storage/upload)
  if (url.pathname === '/api/v1/storage/upload' && request.method === 'POST') {
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

      if (!fileBase64) {
        return new Response(JSON.stringify({ error: 'Missing file_data in JSON body' }), { status: 400, headers: corsHeaders });
      }

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
      if (!formData) {
        return new Response(JSON.stringify({ error: 'Invalid multipart form data' }), { status: 400, headers: corsHeaders });
      }
      const file = formData.get('file');
      folder = (formData.get('folder') || 'products').toString();
      if (!file || typeof file === 'string') {
        return new Response(JSON.stringify({ error: 'No file found in multipart upload' }), { status: 400, headers: corsHeaders });
      }

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
      return new Response(JSON.stringify({ error: 'Unsupported Content-Type for upload' }), { status: 415, headers: corsHeaders });
    }

    if (!ALLOWED_CONTENT_TYPES.includes(mimeType) && !mimeType.startsWith('image/')) {
      return new Response(JSON.stringify({
        error: `Invalid file type: ${mimeType}. Allowed types: ${ALLOWED_CONTENT_TYPES.join(', ')}`
      }), { status: 400, headers: corsHeaders });
    }

    const byteSize = fileBytes.byteLength;
    if (byteSize > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'File size exceeds 10MB limit' }), { status: 400, headers: corsHeaders });
    }

    const extMatch = originalName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : (mimeType === 'image/webp' ? 'webp' : 'png');
    const fileId = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
      `INSERT INTO storage_objects (id, original_name, content_type, byte_size, folder, storage_backend, data_base64, public_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      fileId,
      originalName,
      mimeType,
      byteSize,
      folder,
      storageBackend,
      storageBackend === 'D1_EMBEDDED' ? fileBase64 : null,
      publicUrl
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
        uploaded_at: new Date().toISOString()
      }
    }), { status: 201, headers: corsHeaders });
  }

  // 2. File Download & CDN Streaming (GET /api/v1/storage/file/*)
  if (url.pathname.startsWith('/api/v1/storage/file/') && request.method === 'GET') {
    const fileKey = url.pathname.replace('/api/v1/storage/file/', '').trim();
    if (!fileKey) {
      return new Response('Missing file key', { status: 400, headers: corsHeaders });
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
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          headers.set('Access-Control-Allow-Origin', '*');
          return new Response(object.body, { headers });
        }
      } catch (_) {}
    }

    // B. Check D1 Storage Object
    const row = await env.DB.prepare('SELECT * FROM storage_objects WHERE id = ?').bind(fileKey).first();
    if (!row || !row.data_base64) {
      return new Response(JSON.stringify({ error: 'File not found in storage' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const binaryString = atob(row.data_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(bytes.buffer, {
      status: 200,
      headers: {
        'Content-Type': row.content_type || 'image/png',
        'Content-Length': String(row.byte_size || bytes.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  return null;
}

