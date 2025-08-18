import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { Bindings } from './types'

export const api = new Hono<{ Bindings: Bindings }>()

const TITLE_QUOTA_BYTES = 200 * 1024 * 1024; // 200 MB

// Utility: sum of current usage for a title
async function getTitleUsageBytes(env: Bindings, titleId: number): Promise<number> {
  const rs = await env.DB.prepare(
    `SELECT
       COALESCE((SELECT SUM(size_bytes) FROM artworks  WHERE title_id = ?), 0) +
       COALESCE((SELECT SUM(size_bytes) FROM documents WHERE title_id = ?), 0) +
       COALESCE((SELECT SUM(size_bytes) FROM captions  WHERE title_id = ?), 0) AS used`
  ).bind(titleId, titleId, titleId).all();
  // @ts-ignore
  return (rs.results?.[0]?.used as number) ?? 0;
}

function fail(c: any, status: number, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ error: message, ...extra }, status);
}

function contentTypeOf(filename: string): string | undefined {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.vtt')) return 'text/vtt'
  if (lower.endsWith('.srt')) return 'application/x-subrip'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return undefined
}

// Admin: bootstrap schema (local/dev convenience)
const schemaSQL = `
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

// Disabled in production – enable locally if needed
// api.post('/admin/bootstrap', async (c) => { await c.env.DB.exec(schemaSQL); return c.json({ ok: true }) })
api.get('/health', (c) => c.json({ ok: true }))

// File streaming (secure)
api.get('/file/*', async (c) => {
  const key = c.req.path.replace(/^\/api\/file\//, '')
  if (!key) return fail(c, 400, 'missing key')
  if (!c.env.R2) return fail(c, 500, 'R2 not bound')
  const obj = await c.env.R2.get(key)
  if (!obj) return fail(c, 404, 'not found')
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' } })
})

// Title usage
// Usage for a title
api.get('/titles/:id/usage', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const used = await getTitleUsageBytes(c.env, id)
  return c.json({ used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })
})

// Utility helpers
const MB = (n: number) => n * 1024 * 1024
const ARTWORK_MAX = MB(10)
const CAPTION_MAX = MB(2)
const DOC_MAX = MB(20)
const ARTWORK_KINDS = new Set(['poster','landscape_16_9','portrait_2_3','banner'])
const CAPTION_KINDS = new Set(['subtitles','captions','sdh'])
const DOC_TYPES = new Set(['chain_of_title','copyright_reg','eo_insurance','music_cue_sheet','composer_agreement','talent_release','location_release','underlying_rights','w9_w8','trailer_prores','screener','qc_report','metadata_sheet','poster_psd','key_art_psd','delivery_schedule','other'])

async function moveToTrash(env: Bindings, key: string) {
  try {
    const obj = await env.R2?.get(key)
    if (obj && obj.body) {
      await env.R2!.put(`trash/${key}`, obj.body, { httpMetadata: obj.httpMetadata })
      await env.R2!.delete(key)
    }
  } catch (_) {
    // best-effort
  }
}

// Titles
// List titles
api.get('/titles', async (c) => {
  const rs = await c.env.DB.prepare('SELECT id, name, status, created_at FROM titles ORDER BY id DESC').all()
  return c.json(rs.results) // [{ id, name, status, created_at }]
})

// Create title
api.post('/titles',
  validator('json', (value, c) => {
    if (!value?.name || typeof value.name !== 'string') return c.text('name is required', 400) // simple validation
    return value
  }),
  async (c) => {
    const { name } = await c.req.json<{ name: string }>()
    const res = await c.env.DB.prepare('INSERT INTO titles (name) VALUES (?)').bind(name).run()
    return c.json({ id: res.meta.last_row_id, name, status: 'incomplete' }, 201)
  }
)

// Uploads: Artwork (list)
api.get('/titles/:id/artworks', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, kind, r2_key, size_bytes, content_type, status FROM artworks WHERE title_id = ? ORDER BY kind').bind(id).all()
  return c.json(rs.results)
})

// Uploads: Artwork (delete)
api.delete('/artworks/:artId', async (c) => {
  const artId = Number(c.req.param('artId'))
  if (!Number.isFinite(artId)) return fail(c, 400, 'invalid id')
  const rs = await c.env.DB.prepare('SELECT r2_key FROM artworks WHERE id=?').bind(artId).all()
  const row = (rs.results as any[])?.[0]
  if (!row) return fail(c, 404, 'not found')
  if (row.r2_key && c.env.R2) await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM artworks WHERE id=?').bind(artId).run()
  return c.json({ ok: true })
})

// Uploads: Artwork (upload)
api.post('/titles/:id/artworks', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  if (!c.env.R2) return fail(c, 500, 'R2 not bound')

  const contentType = c.req.header('content-type') || ''
  if (!contentType.startsWith('multipart/form-data')) return fail(c, 400, 'content-type must be multipart/form-data')

  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const kind = (form.get('kind') as string | null)?.toLowerCase()
  if (!file) return fail(c, 400, 'file is required')
  if (!kind || !ARTWORK_KINDS.has(kind)) return fail(c, 400, 'invalid kind', { allowed: Array.from(ARTWORK_KINDS) })
  if (file.size > ARTWORK_MAX) return fail(c, 413, 'file too large', { max_bytes: ARTWORK_MAX })

  const inferred = contentTypeOf(file.name) || file.type
  if (!['image/jpeg','image/png','image/webp'].includes(inferred)) return fail(c, 400, 'unsupported file type')

  // Quota
  const used = await getTitleUsageBytes(c.env, id)
  if (used + file.size > TITLE_QUOTA_BYTES) return fail(c, 413, 'quota exceeded', { used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })

  // Replace policy: move old to trash if exists
  const prev = await c.env.DB.prepare('SELECT id, r2_key FROM artworks WHERE title_id = ? AND kind = ?').bind(id, kind).all()
  const prevRow = (prev.results as any[])?.[0]

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const key = `titles/${id}/artwork/${Date.now()}-${Math.random().toString(36).slice(2)}-${kind}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: inferred } })

  if (prevRow?.r2_key) await moveToTrash(c.env, prevRow.r2_key)

  // Upsert
  if (prevRow) {
    await c.env.DB.prepare('UPDATE artworks SET r2_key=?, size_bytes=?, content_type=?, status="uploaded" WHERE id=?')
      .bind(key, file.size, inferred, prevRow.id).run()
  } else {
    await c.env.DB.prepare('INSERT INTO artworks (title_id, kind, r2_key, size_bytes, content_type, status) VALUES (?,?,?,?,?,"uploaded")')
      .bind(id, kind, key, file.size, inferred).run()
  }

  return c.json({ ok: true, key })
})

// Uploads: Captions (list)
api.get('/titles/:id/captions', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, language, kind, r2_key, size_bytes, content_type, status FROM captions WHERE title_id = ? ORDER BY language, kind').bind(id).all()
  return c.json(rs.results)
})

// Uploads: Captions (delete)
api.delete('/captions/:capId', async (c) => {
  const capId = Number(c.req.param('capId'))
  if (!Number.isFinite(capId)) return fail(c, 400, 'invalid id')
  const rs = await c.env.DB.prepare('SELECT r2_key FROM captions WHERE id=?').bind(capId).all()
  const row = (rs.results as any[])?.[0]
  if (!row) return fail(c, 404, 'not found')
  if (row.r2_key && c.env.R2) await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM captions WHERE id=?').bind(capId).run()
  return c.json({ ok: true })
})

// Uploads: Captions (upload)
api.post('/titles/:id/captions', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  if (!c.env.R2) return fail(c, 500, 'R2 not bound')
  const ct = c.req.header('content-type') || ''
  if (!ct.startsWith('multipart/form-data')) return fail(c, 400, 'content-type must be multipart/form-data')

  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const language = (form.get('language') as string | null)?.toLowerCase()
  const kind = (form.get('kind') as string | null)?.toLowerCase()
  if (!file) return fail(c, 400, 'file is required')
  if (!language) return fail(c, 400, 'language is required')
  if (!kind || !CAPTION_KINDS.has(kind)) return fail(c, 400, 'invalid kind', { allowed: Array.from(CAPTION_KINDS) })
  if (file.size > CAPTION_MAX) return fail(c, 413, 'file too large', { max_bytes: CAPTION_MAX })
  const inferred = contentTypeOf(file.name) || file.type
  if (!['text/vtt','application/x-subrip'].includes(inferred)) return fail(c, 400, 'unsupported file type')

  const used = await getTitleUsageBytes(c.env, id)
  if (used + file.size > TITLE_QUOTA_BYTES) return fail(c, 413, 'quota exceeded', { used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })

  const prev = await c.env.DB.prepare('SELECT id, r2_key FROM captions WHERE title_id = ? AND language = ? AND kind = ?').bind(id, language, kind).all()
  const prevRow = (prev.results as any[])?.[0]
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const key = `titles/${id}/captions/${Date.now()}-${Math.random().toString(36).slice(2)}-${language}-${kind}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: inferred } })
  if (prevRow?.r2_key) await moveToTrash(c.env, prevRow.r2_key)

  if (prevRow) {
    await c.env.DB.prepare('UPDATE captions SET r2_key=?, size_bytes=?, content_type=?, status="uploaded" WHERE id=?')
      .bind(key, file.size, inferred, prevRow.id).run()
  } else {
    await c.env.DB.prepare('INSERT INTO captions (title_id, language, kind, r2_key, size_bytes, content_type, status) VALUES (?,?,?,?,?, ?,"uploaded")')
      .bind(id, language, kind, key, file.size, inferred).run()
  }
  return c.json({ ok: true, key })
})

// Uploads: Documents (list)
api.get('/titles/:id/documents', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, doc_type, r2_key, size_bytes, content_type, status FROM documents WHERE title_id = ? ORDER BY doc_type').bind(id).all()
  return c.json(rs.results)
})

// Uploads: Documents (delete)
api.delete('/documents/:docId', async (c) => {
  const docId = Number(c.req.param('docId'))
  if (!Number.isFinite(docId)) return fail(c, 400, 'invalid id')
  const rs = await c.env.DB.prepare('SELECT r2_key FROM documents WHERE id=?').bind(docId).all()
  const row = (rs.results as any[])?.[0]
  if (!row) return fail(c, 404, 'not found')
  if (row.r2_key && c.env.R2) await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM documents WHERE id=?').bind(docId).run()
  return c.json({ ok: true })
})

// Uploads: Documents (upload)
api.post('/titles/:id/documents', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  if (!c.env.R2) return fail(c, 500, 'R2 not bound')
  const ct = c.req.header('content-type') || ''
  if (!ct.startsWith('multipart/form-data')) return fail(c, 400, 'content-type must be multipart/form-data')

  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const docType = (form.get('doc_type') as string | null)?.toLowerCase()
  if (!file) return fail(c, 400, 'file is required')
  if (!docType || !DOC_TYPES.has(docType)) return fail(c, 400, 'invalid doc_type', { allowed: Array.from(DOC_TYPES) })
  if (file.size > DOC_MAX) return fail(c, 413, 'file too large', { max_bytes: DOC_MAX })
  const inferred = contentTypeOf(file.name) || file.type
  if (!['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(inferred)) return fail(c, 400, 'unsupported file type')

  const used = await getTitleUsageBytes(c.env, id)
  if (used + file.size > TITLE_QUOTA_BYTES) return fail(c, 413, 'quota exceeded', { used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })

  const prev = await c.env.DB.prepare('SELECT id, r2_key FROM documents WHERE title_id = ? AND doc_type = ?').bind(id, docType).all()
  const prevRow = (prev.results as any[])?.[0]
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const key = `titles/${id}/documents/${Date.now()}-${Math.random().toString(36).slice(2)}-${docType}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: inferred } })
  if (prevRow?.r2_key) await moveToTrash(c.env, prevRow.r2_key)

  if (prevRow) {
    await c.env.DB.prepare('UPDATE documents SET r2_key=?, size_bytes=?, content_type=?, status="uploaded" WHERE id=?')
      .bind(key, file.size, inferred, prevRow.id).run()
  } else {
    await c.env.DB.prepare('INSERT INTO documents (title_id, doc_type, r2_key, size_bytes, content_type, status) VALUES (?,?,?,?,?, ?,"uploaded")')
      .bind(id, docType, key, file.size, inferred).run()
  }
  return c.json({ ok: true, key })
})
