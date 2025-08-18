import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { Bindings } from './types'

export const api = new Hono<{ Bindings: Bindings }>()

const TITLE_QUOTA_BYTES = 200 * 1024 * 1024 // 200 MB

// Utility: sum of current usage for a title
async function getTitleUsageBytes(env: Bindings, titleId: number): Promise<number> {
  const rs = await env.DB.prepare(
    `SELECT
       COALESCE((SELECT SUM(size_bytes) FROM artworks  WHERE title_id = ?), 0) +
       COALESCE((SELECT SUM(size_bytes) FROM documents WHERE title_id = ?), 0) +
       COALESCE((SELECT SUM(size_bytes) FROM captions  WHERE title_id = ?), 0) AS used`
  ).bind(titleId, titleId, titleId).all()
  // @ts-ignore
  return (rs.results?.[0]?.used as number) ?? 0
}

function fail(c: any, status: number, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ error: message, ...extra }, status)
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

// Health
api.get('/health', (c) => c.json({ ok: true }))

// Seed example content if empty (dev helper)
api.post('/seed-if-empty', async (c) => {
  const rs = await c.env.DB.prepare('SELECT COUNT(*) as n FROM titles').all()
  // @ts-ignore
  const n = Number((rs.results?.[0]?.n) || 0)
  if (n > 0) return c.json({ ok: true, skipped: true })

  const titleName = 'The Last Lotus'
  const res = await c.env.DB.prepare('INSERT INTO titles (name, status) VALUES (?,?)').bind(titleName, 'incomplete').run()
  const id = Number(res.meta.last_row_id)

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO title_profiles (title_id, sales_title, synopsis, genres, keywords, format, spoken_language, origin_country, runtime_minutes, release_date, rating_system, rating, production_company, website)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,
    'The Last Lotus',
    'A Vietnamese-American filmmaker returns to Saigon to finish a film his father started, uncovering secrets that threaten his crew and his heart.',
    'Drama, Mystery',
    'Vietnam, Saigon, family, identity, cinema',
    'Movie',
    'English, Vietnamese',
    'VN',
    102,
    '2025-07-04',
    'MPAA',
    'PG-13',
    'Sutudu Pictures',
    'https://sutudu.com/lastlotus'
  ).run()

  await c.env.DB.prepare('INSERT INTO avails (title_id, license_type, territories, start_date, end_date, exclusive) VALUES (?,?,?,?,?,?)')
    .bind(id, 'avod', 'US,CA,GB,AU', '2025-08-01', null, 0).run()

  await c.env.DB.prepare('INSERT OR IGNORE INTO artworks (title_id, kind, status) VALUES (?,?,?)').bind(id, 'poster', 'missing').run()
  await c.env.DB.prepare('INSERT OR IGNORE INTO documents (title_id, doc_type, status) VALUES (?,?,?)').bind(id, 'chain_of_title', 'missing').run()
  await c.env.DB.prepare('INSERT OR IGNORE INTO captions (title_id, language, kind, status) VALUES (?,?,?,?)').bind(id, 'en', 'subtitles', 'missing').run()

  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)')
    .bind(id, 'created_title', JSON.stringify({ name: titleName })).run()

  return c.json({ ok: true, id })
})

// File streaming (secure)
api.get('/file/*', async (c) => {
  const key = c.req.path.replace(/^\/api\/file\//, '')
  if (!key) return fail(c, 400, 'missing key')
  if (!c.env.R2) return fail(c, 500, 'R2 not bound')
  const obj = await c.env.R2.get(key)
  if (!obj) return fail(c, 404, 'not found')
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' } })
})

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
const ARTWORK_KINDS = new Set(['poster', 'landscape_16_9', 'portrait_2_3', 'banner'])
const CAPTION_KINDS = new Set(['subtitles', 'captions', 'sdh'])
const DOC_TYPES = new Set([
  'chain_of_title',
  'copyright_reg',
  'eo_insurance',
  'music_cue_sheet',
  'composer_agreement',
  'talent_release',
  'location_release',
  'underlying_rights',
  'w9_w8',
  'trailer_prores',
  'screener',
  'qc_report',
  'metadata_sheet',
  'poster_psd',
  'key_art_psd',
  'delivery_schedule',
  'other'
])

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

// Titles list with optional search/status/pagination and poster thumbnail
api.get('/titles', async (c) => {
  const url = new URL(c.req.url)
  const q = url.searchParams.get('q')?.trim()
  const status = url.searchParams.get('status')?.trim()
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
  const per = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')))
  const where: string[] = []
  const binds: any[] = []
  if (q) {
    where.push('name LIKE ?')
    binds.push(`%${q}%`)
  }
  if (status) {
    where.push('status = ?')
    binds.push(status)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const offset = (page - 1) * per
  const sql = `SELECT t.id, t.name, t.status, t.created_at,
    (SELECT r2_key FROM artworks a WHERE a.title_id=t.id AND a.kind='poster') AS poster_key
    FROM titles t ${whereSql} ORDER BY t.id DESC LIMIT ? OFFSET ?`
  const rs = await c.env.DB.prepare(sql).bind(...binds, per, offset).all()
  return c.json(rs.results)
})

// Create title
api.post(
  '/titles',
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

// Title Profile: GET/PUT (all optional fields for now)
api.get('/titles/:id/profile', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT * FROM title_profiles WHERE title_id = ?').bind(id).all()
  const row = (rs.results as any[])?.[0] || null
  return c.json(row)
})

api.put('/titles/:id/profile', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const body = await c.req.json<any>()
  const fields = [
    'sales_title',
    'synopsis',
    'genres',
    'keywords',
    'format',
    'spoken_language',
    'dubbed_languages',
    'caption_languages',
    'origin_country',
    'runtime_minutes',
    'release_date',
    'rating_system',
    'rating',
    'production_company',
    'website'
  ]
  const placeholders = fields.map((f) => `${f} = ?`).join(', ')
  const values = fields.map((f) => (body as any)?.[f] ?? null)
  await c.env.DB.prepare('INSERT OR IGNORE INTO title_profiles (title_id) VALUES (?)').bind(id).run()
  await c.env.DB.prepare(`UPDATE title_profiles SET ${placeholders} WHERE title_id = ?`).bind(...values, id).run()
  const rs = await c.env.DB.prepare('SELECT * FROM title_profiles WHERE title_id = ?').bind(id).all()
  return c.json((rs.results as any[])?.[0] || null)
})

// Artwork APIs
api.get('/titles/:id/artworks', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, kind, r2_key, size_bytes, content_type, status FROM artworks WHERE title_id = ? ORDER BY kind').bind(id).all()
  return c.json(rs.results)
})

api.delete('/artworks/:artId', async (c) => {
  const artId = Number(c.req.param('artId'))
  if (!Number.isFinite(artId)) return fail(c, 400, 'invalid id')
  const rs = await c.env.DB.prepare('SELECT r2_key FROM artworks WHERE id=?').bind(artId).all()
  const row = (rs.results as any[])?.[0]
  if (!row) return fail(c, 404, 'not found')
  if (row.r2_key && c.env.R2) await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM artworks WHERE id=?').bind(artId).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) SELECT title_id, ?, ? FROM artworks WHERE id=?')
    .bind('artwork_deleted', JSON.stringify({ id: artId }), artId).run()
  return c.json({ ok: true })
})

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
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(inferred)) return fail(c, 400, 'unsupported file type')

  const used = await getTitleUsageBytes(c.env, id)
  if (used + file.size > TITLE_QUOTA_BYTES)
    return fail(c, 413, 'quota exceeded', { used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })

  const prev = await c.env.DB.prepare('SELECT id, r2_key FROM artworks WHERE title_id = ? AND kind = ?').bind(id, kind).all()
  const prevRow = (prev.results as any[])?.[0]

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const key = `titles/${id}/artwork/${Date.now()}-${Math.random().toString(36).slice(2)}-${kind}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: inferred } })
  if (prevRow?.r2_key) await moveToTrash(c.env, prevRow.r2_key)

  if (prevRow) {
    await c.env.DB.prepare('UPDATE artworks SET r2_key=?, size_bytes=?, content_type=?, status="uploaded" WHERE id=?').bind(key, file.size, inferred, prevRow.id).run()
  } else {
    await c.env.DB.prepare('INSERT INTO artworks (title_id, kind, r2_key, size_bytes, content_type, status) VALUES (?,?,?,?,?, "uploaded")').bind(id, kind, key, file.size, inferred).run()
  }

  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'artwork_uploaded', JSON.stringify({ kind, key })).run()
  return c.json({ ok: true, key })
})

api.post('/artworks/:artId/status', async (c) => {
  const artId = Number(c.req.param('artId'))
  const { status, notes } = await c.req.json<any>()
  if (!['uploaded', 'approved', 'rejected'].includes(status)) return fail(c, 400, 'invalid status')
  await c.env.DB.prepare('UPDATE artworks SET status=?, notes=? WHERE id=?').bind(status, notes ?? null, artId).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) SELECT title_id, ?, ? FROM artworks WHERE id=?')
    .bind('artwork_status', JSON.stringify({ id: artId, status }), artId).run()
  return c.json({ ok: true })
})

// Captions APIs
api.get('/titles/:id/captions', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, language, kind, r2_key, size_bytes, content_type, status FROM captions WHERE title_id = ? ORDER BY language, kind').bind(id).all()
  return c.json(rs.results)
})

api.delete('/captions/:capId', async (c) => {
  const capId = Number(c.req.param('capId'))
  if (!Number.isFinite(capId)) return fail(c, 400, 'invalid id')
  const rs = await c.env.DB.prepare('SELECT r2_key FROM captions WHERE id=?').bind(capId).all()
  const row = (rs.results as any[])?.[0]
  if (!row) return fail(c, 404, 'not found')
  if (row.r2_key && c.env.R2) await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM captions WHERE id=?').bind(capId).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) SELECT title_id, ?, ? FROM captions WHERE id=?')
    .bind('captions_deleted', JSON.stringify({ id: capId }), capId).run()
  return c.json({ ok: true })
})

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
  if (!['text/vtt', 'application/x-subrip'].includes(inferred)) return fail(c, 400, 'unsupported file type')

  const used = await getTitleUsageBytes(c.env, id)
  if (used + file.size > TITLE_QUOTA_BYTES)
    return fail(c, 413, 'quota exceeded', { used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })

  const prev = await c.env.DB.prepare('SELECT id, r2_key FROM captions WHERE title_id = ? AND language = ? AND kind = ?').bind(id, language, kind).all()
  const prevRow = (prev.results as any[])?.[0]
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const key = `titles/${id}/captions/${Date.now()}-${Math.random().toString(36).slice(2)}-${language}-${kind}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: inferred } })
  if (prevRow?.r2_key) await moveToTrash(c.env, prevRow.r2_key)

  if (prevRow) {
    await c.env.DB.prepare('UPDATE captions SET r2_key=?, size_bytes=?, content_type=?, status="uploaded" WHERE id=?').bind(key, file.size, inferred, prevRow.id).run()
  } else {
    await c.env.DB.prepare('INSERT INTO captions (title_id, language, kind, r2_key, size_bytes, content_type, status) VALUES (?,?,?,?,?, ?,"uploaded")').bind(id, language, kind, key, file.size, inferred).run()
  }
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'captions_uploaded', JSON.stringify({ language, kind, key })).run()
  return c.json({ ok: true, key })
})

// Documents APIs
api.get('/titles/:id/documents', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, doc_type, r2_key, size_bytes, content_type, status FROM documents WHERE title_id = ? ORDER BY doc_type').bind(id).all()
  return c.json(rs.results)
})

api.delete('/documents/:docId', async (c) => {
  const docId = Number(c.req.param('docId'))
  if (!Number.isFinite(docId)) return fail(c, 400, 'invalid id')
  const rs = await c.env.DB.prepare('SELECT r2_key FROM documents WHERE id=?').bind(docId).all()
  const row = (rs.results as any[])?.[0]
  if (!row) return fail(c, 404, 'not found')
  if (row.r2_key && c.env.R2) await c.env.R2.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM documents WHERE id=?').bind(docId).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) SELECT title_id, ?, ? FROM documents WHERE id=?')
    .bind('document_deleted', JSON.stringify({ id: docId }), docId).run()
  return c.json({ ok: true })
})

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
  if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(inferred)) return fail(c, 400, 'unsupported file type')

  const used = await getTitleUsageBytes(c.env, id)
  if (used + file.size > TITLE_QUOTA_BYTES)
    return fail(c, 413, 'quota exceeded', { used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })

  const prev = await c.env.DB.prepare('SELECT id, r2_key FROM documents WHERE title_id = ? AND doc_type = ?').bind(id, docType).all()
  const prevRow = (prev.results as any[])?.[0]
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const key = `titles/${id}/documents/${Date.now()}-${Math.random().toString(36).slice(2)}-${docType}.${ext}`
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: inferred } })
  if (prevRow?.r2_key) await moveToTrash(c.env, prevRow.r2_key)

  if (prevRow) {
    await c.env.DB.prepare('UPDATE documents SET r2_key=?, size_bytes=?, content_type=?, status="uploaded" WHERE id=?').bind(key, file.size, inferred, prevRow.id).run()
  } else {
    await c.env.DB.prepare('INSERT INTO documents (title_id, doc_type, r2_key, size_bytes, content_type, status) VALUES (?,?,?,?,?, "uploaded")').bind(id, docType, key, file.size, inferred).run()
  }
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'document_uploaded', JSON.stringify({ doc_type: docType, key })).run()
  return c.json({ ok: true, key })
})

api.post('/documents/:docId/status', async (c) => {
  const docId = Number(c.req.param('docId'))
  const { status, notes } = await c.req.json<any>()
  if (!['uploaded', 'approved', 'rejected'].includes(status)) return fail(c, 400, 'invalid status')
  await c.env.DB.prepare('UPDATE documents SET status=?, notes=? WHERE id=?').bind(status, notes ?? null, docId).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) SELECT title_id, ?, ? FROM documents WHERE id=?')
    .bind('document_status', JSON.stringify({ id: docId, status }), docId).run()
  return c.json({ ok: true })
})

// Avails
api.get('/titles/:id/avails', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const rs = await c.env.DB.prepare('SELECT id, license_type, territories, start_date, end_date, exclusive FROM avails WHERE title_id = ? ORDER BY id DESC').bind(id).all()
  return c.json(rs.results)
})

api.post('/titles/:id/avails', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const { license_type, territories, start_date, end_date, exclusive } = await c.req.json<any>()
  if (!['avod', 'svod', 'tvod'].includes(license_type)) return fail(c, 400, 'invalid license_type')
  if (!territories || typeof territories !== 'string') return fail(c, 400, 'territories required')
  if (!start_date) return fail(c, 400, 'start_date required')
  const excl = exclusive ? 1 : 0
  const res = await c.env.DB.prepare('INSERT INTO avails (title_id, license_type, territories, start_date, end_date, exclusive) VALUES (?,?,?,?,?,?)')
    .bind(id, license_type, territories, start_date, end_date ?? null, excl)
    .run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'avail_created', JSON.stringify({ id: res.meta.last_row_id })).run()
  return c.json({ id: res.meta.last_row_id })
})

api.put('/avails/:availId', async (c) => {
  const availId = Number(c.req.param('availId'))
  if (!Number.isFinite(availId)) return fail(c, 400, 'invalid id')
  const { license_type, territories, start_date, end_date, exclusive } = await c.req.json<any>()
  const excl = exclusive ? 1 : 0
  await c.env.DB.prepare('UPDATE avails SET license_type=?, territories=?, start_date=?, end_date=?, exclusive=? WHERE id=?')
    .bind(license_type, territories, start_date, end_date ?? null, excl, availId)
    .run()
  return c.json({ ok: true })
})

api.delete('/avails/:availId', async (c) => {
  const availId = Number(c.req.param('availId'))
  if (!Number.isFinite(availId)) return fail(c, 400, 'invalid id')
  await c.env.DB.prepare('DELETE FROM avails WHERE id=?').bind(availId).run()
  return c.json({ ok: true })
})

// Updates feed
api.get('/updates', async (c) => {
  const url = new URL(c.req.url)
  const titleId = url.searchParams.get('title_id')
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
  const per = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')))
  const offset = (page - 1) * per
  const where = titleId ? 'WHERE title_id = ?' : ''
  const rs = await c.env.DB.prepare(`SELECT id, title_id, event_type, info, created_at FROM updates ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...(titleId ? [Number(titleId)] : []), per, offset)
    .all()
  return c.json(rs.results)
})
