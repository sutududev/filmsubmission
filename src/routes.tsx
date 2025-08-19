import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { AppContext, Bindings } from './types'

// Constants
const TITLE_QUOTA_BYTES = 200 * 1024 * 1024

// Helpers
function contentTypeOf(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    srt: 'text/plain', vtt: 'text/vtt',
  }
  return map[ext] || 'application/octet-stream'
}

async function getTitleUsageBytes(env: Bindings, titleId: number): Promise<number> {
  const r = await env.DB.prepare('SELECT used_bytes FROM title_usage_bytes WHERE title_id = ?').bind(titleId).first<any>()
  return (r?.used_bytes as number) || 0
}

async function moveToTrash(env: Bindings, key: string) {
  if (!env.R2) return
  const obj = await env.R2.get(key)
  if (!obj) return
  const trashKey = `trash/${key.replace(/^trash\//,'')}`
  await env.R2.put(trashKey, obj.body as ReadableStream, { httpMetadata: obj.httpMetadata })
  await env.R2.delete(key)
}

// Validation schemas
const titleSchema = z.object({ name: z.string().min(1) })

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// Health
app.get('/api/health', c => c.json({ ok: true }))

// R2 streaming
app.get('/api/file/*', async (c) => {
  const key = c.req.path.replace('/api/file/','')
  const obj = await c.env.R2?.get(key)
  if (!obj) return c.notFound()
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    }
  })
})

// List titles with optional filters and computed readiness
app.get('/api/titles', async (c) => {
  const { q = '', status = '', per_page = '50' } = c.req.query()
  const limit = Math.min(100, Math.max(1, parseInt(String(per_page), 10) || 50))
  const params: any[] = []
  let where = 'WHERE 1=1'
  if (q) { where += ' AND t.name LIKE ?'; params.push(`%${q}%`) }
  const sql = `
    SELECT
      t.id, t.name, t.status AS original_status, t.created_at,
      (
        SELECT a.r2_key FROM artworks a
        WHERE a.title_id = t.id AND a.kind = 'poster'
      ) AS poster_key,
      (
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM artworks a WHERE a.title_id = t.id AND a.kind = 'poster' AND a.status != 'missing' AND a.r2_key IS NOT NULL
        ) THEN 1 ELSE 0 END) +
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM captions c2 WHERE c2.title_id = t.id AND c2.language = 'en' AND c2.kind = 'subtitles' AND c2.status != 'missing' AND c2.r2_key IS NOT NULL
        ) THEN 1 ELSE 0 END) +
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM documents d WHERE d.title_id = t.id AND d.doc_type = 'chain_of_title' AND d.status != 'missing' AND d.r2_key IS NOT NULL
        ) THEN 1 ELSE 0 END) +
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM avails v WHERE v.title_id = t.id
        ) THEN 1 ELSE 0 END)
      ) AS ready_score,
      CASE WHEN (
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM artworks a WHERE a.title_id = t.id AND a.kind = 'poster' AND a.status != 'missing' AND a.r2_key IS NOT NULL
        ) THEN 1 ELSE 0 END) +
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM captions c2 WHERE c2.title_id = t.id AND c2.language = 'en' AND c2.kind = 'subtitles' AND c2.status != 'missing' AND c2.r2_key IS NOT NULL
        ) THEN 1 ELSE 0 END) +
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM documents d WHERE d.title_id = t.id AND d.doc_type = 'chain_of_title' AND d.status != 'missing' AND d.r2_key IS NOT NULL
        ) THEN 1 ELSE 0 END) +
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM avails v WHERE v.title_id = t.id
        ) THEN 1 ELSE 0 END)
      ) = 4 THEN 'ready' ELSE 'incomplete' END AS computed_status
    FROM titles t
    ${where}
  `
  const wrapped = `SELECT * FROM ( ${sql} ) WHERE (? = '' OR computed_status = ?) ORDER BY id DESC LIMIT ?`
  params.push(status, status, limit)
  const rows = await c.env.DB.prepare(wrapped).bind(...params).all()
  return c.json(rows.results)
})

// Create title
app.post('/api/titles', async (c) => {
  const body = await c.req.json()
  const v = titleSchema.safeParse(body)
  if (!v.success) return c.text('Invalid', 400)
  const r = await c.env.DB.prepare('INSERT INTO titles (name) VALUES (?)').bind(v.data.name).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(r.meta.last_row_id, 'created_title', v.data.name).run()
  return c.json({ id: r.meta.last_row_id })
})

// Title usage
app.get('/api/titles/:id/usage', async (c) => {
  const id = Number(c.req.param('id'))
  const used = await getTitleUsageBytes(c.env, id)
  return c.json({ title_id: id, used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES })
})

// Title profile upsert then update
app.get('/api/titles/:id/profile', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('INSERT OR IGNORE INTO title_profiles (title_id) VALUES (?)').bind(id).run()
  const row = await c.env.DB.prepare('SELECT * FROM title_profiles WHERE title_id = ?').bind(id).first<any>()
  return c.json(row)
})
app.put('/api/titles/:id/profile', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const cols = ['sales_title','synopsis','genres','keywords','format','spoken_language','dubbed_languages','caption_languages','origin_country','runtime_minutes','release_date','rating_system','rating','production_company','website']
  const set = cols.map(k => `${k} = ?`).join(',')
  const vals = cols.map(k => body[k] ?? null)
  await c.env.DB.prepare(`INSERT OR IGNORE INTO title_profiles (title_id) VALUES (?)`).bind(id).run()
  await c.env.DB.prepare(`UPDATE title_profiles SET ${set} WHERE title_id = ?`).bind(...vals, id).run()
  return c.json({ ok: true })
})

// Artworks
app.get('/api/titles/:id/artworks', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM artworks WHERE title_id = ?').bind(id).all()
  return c.json(rows.results)
})

app.post('/api/titles/:id/artworks', async (c) => {
  const id = Number(c.req.param('id'))
  const contentTypeLimit = 10 * 1024 * 1024
  const form = await c.req.formData()
  const kind = String(form.get('kind') || 'poster')
  const file = form.get('file') as File | null
  if (!file) return c.text('No file', 400)
  if (file.size > contentTypeLimit) return c.text('Artwork too large', 413)
  const allowed = ['image/jpeg','image/png','image/webp']
  if (!allowed.includes(file.type)) return c.text('Invalid artwork MIME', 415)

  // Quota check (consider replacement)
  const used = await getTitleUsageBytes(c.env, id)
  const prev = await c.env.DB.prepare('SELECT r2_key, size_bytes FROM artworks WHERE title_id = ? AND kind = ?').bind(id, kind).first<any>()
  const prevSize = Number(prev?.size_bytes || 0)
  if (used - prevSize + file.size > TITLE_QUOTA_BYTES) return c.text('Quota exceeded', 413)

  // Replace policy
  if (prev?.r2_key) await moveToTrash(c.env, prev.r2_key)

  const key = `titles/${id}/artworks/${kind}-${Date.now()}`
  await c.env.R2?.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }})
  await c.env.DB.prepare(`INSERT INTO artworks (title_id, kind, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?)
    ON CONFLICT(title_id, kind) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`).
    bind(id, kind, key, 'uploaded', file.size, file.type).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'artwork_uploaded', kind).run()
  return c.json({ key })
})

app.post('/api/artworks/:artId/status', async (c) => {
  const id = Number(c.req.param('artId'))
  const { status } = await c.req.json()
  await c.env.DB.prepare('UPDATE artworks SET status = ? WHERE id = ?').bind(status, id).run()
  return c.json({ ok: true })
})

app.delete('/api/artworks/:artId', async (c) => {
  const id = Number(c.req.param('artId'))
  const row = await c.env.DB.prepare('SELECT r2_key, title_id FROM artworks WHERE id = ?').bind(id).first<any>()
  if (row?.r2_key) await moveToTrash(c.env, row.r2_key)
  await c.env.DB.prepare('DELETE FROM artworks WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// Captions
app.get('/api/titles/:id/captions', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM captions WHERE title_id = ?').bind(id).all()
  return c.json(rows.results)
})

app.post('/api/titles/:id/captions', async (c) => {
  const id = Number(c.req.param('id'))
  const limit = 2 * 1024 * 1024
  const form = await c.req.formData()
  const language = String(form.get('language') || 'en')
  const kind = String(form.get('kind') || 'subtitles')
  const file = form.get('file') as File | null
  if (!file) return c.text('No file', 400)
  if (file.size > limit) return c.text('Caption too large', 413)
  const allowed = ['text/vtt','text/plain']
  if (!allowed.includes(file.type)) return c.text('Invalid caption MIME', 415)
  if (!/\.(vtt|srt)$/i.test(file.name)) return c.text('Invalid caption extension', 415)

  const used = await getTitleUsageBytes(c.env, id)
  const prev = await c.env.DB.prepare('SELECT r2_key, size_bytes FROM captions WHERE title_id = ? AND language = ? AND kind = ?').bind(id, language, kind).first<any>()
  const prevSize = Number(prev?.size_bytes || 0)
  if (used - prevSize + file.size > TITLE_QUOTA_BYTES) return c.text('Quota exceeded', 413)

  if (prev?.r2_key) await moveToTrash(c.env, prev.r2_key)

  const key = `titles/${id}/captions/${language}-${kind}-${Date.now()}`
  await c.env.R2?.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }})
  await c.env.DB.prepare(`INSERT INTO captions (title_id, language, kind, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(title_id, language, kind) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`).
    bind(id, language, kind, key, 'uploaded', file.size, file.type).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'captions_uploaded', `${language}/${kind}`).run()
  return c.json({ key })
})

app.delete('/api/captions/:capId', async (c) => {
  const id = Number(c.req.param('capId'))
  const row = await c.env.DB.prepare('SELECT r2_key FROM captions WHERE id = ?').bind(id).first<any>()
  if (row?.r2_key) await moveToTrash(c.env, row.r2_key)
  await c.env.DB.prepare('DELETE FROM captions WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// Documents
app.get('/api/titles/:id/documents', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM documents WHERE title_id = ?').bind(id).all()
  return c.json(rows.results)
})

app.post('/api/titles/:id/documents', async (c) => {
  const id = Number(c.req.param('id'))
  const limit = 20 * 1024 * 1024
  const form = await c.req.formData()
  const doc_type = String(form.get('doc_type') || 'other')
  const file = form.get('file') as File | null
  if (!file) return c.text('No file', 400)
  if (file.size > limit) return c.text('Document too large', 413)
  const allowed = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  if (!allowed.includes(file.type)) return c.text('Invalid document MIME', 415)

  const used = await getTitleUsageBytes(c.env, id)
  const prev = await c.env.DB.prepare('SELECT r2_key, size_bytes FROM documents WHERE title_id = ? AND doc_type = ?').bind(id, doc_type).first<any>()
  const prevSize = Number(prev?.size_bytes || 0)
  if (used - prevSize + file.size > TITLE_QUOTA_BYTES) return c.text('Quota exceeded', 413)

  if (prev?.r2_key) await moveToTrash(c.env, prev.r2_key)

  const key = `titles/${id}/documents/${doc_type}-${Date.now()}`
  await c.env.R2?.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }})
  await c.env.DB.prepare(`INSERT INTO documents (title_id, doc_type, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?)
    ON CONFLICT(title_id, doc_type) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`).
    bind(id, doc_type, key, 'uploaded', file.size, file.type).run()
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'documents_uploaded', doc_type).run()
  return c.json({ key })
})

app.post('/api/documents/:docId/status', async (c) => {
  const id = Number(c.req.param('docId'))
  const { status } = await c.req.json()
  await c.env.DB.prepare('UPDATE documents SET status = ? WHERE id = ?').bind(status, id).run()
  return c.json({ ok: true })
})

app.delete('/api/documents/:docId', async (c) => {
  const id = Number(c.req.param('docId'))
  const row = await c.env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?').bind(id).first<any>()
  if (row?.r2_key) await moveToTrash(c.env, row.r2_key)
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// Avails
app.get('/api/titles/:id/avails', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM avails WHERE title_id = ? ORDER BY id DESC').bind(id).all()
  return c.json(rows.results)
})
app.post('/api/titles/:id/avails', async (c) => {
  const id = Number(c.req.param('id'))
  const { license_type, territories, start_date, end_date, exclusive } = await c.req.json()
  await c.env.DB.prepare('INSERT INTO avails (title_id, license_type, territories, start_date, end_date, exclusive) VALUES (?,?,?,?,?,?)')
    .bind(id, license_type, territories, start_date, end_date, exclusive ? 1 : 0).run()
  return c.json({ ok: true })
})
app.put('/api/avails/:availId', async (c) => {
  const id = Number(c.req.param('availId'))
  const { license_type, territories, start_date, end_date, exclusive } = await c.req.json()
  await c.env.DB.prepare('UPDATE avails SET license_type=?, territories=?, start_date=?, end_date=?, exclusive=? WHERE id=?')
    .bind(license_type, territories, start_date, end_date, exclusive ? 1 : 0, id).run()
  return c.json({ ok: true })
})
app.delete('/api/avails/:availId', async (c) => {
  const id = Number(c.req.param('availId'))
  await c.env.DB.prepare('DELETE FROM avails WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// People: Cast
app.get('/api/titles/:id/cast', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM cast WHERE title_id = ? ORDER BY id DESC').bind(id).all()
  return c.json(rows.results)
})
app.post('/api/titles/:id/cast', async (c) => {
  const id = Number(c.req.param('id'))
  const { name, role } = await c.req.json()
  await c.env.DB.prepare('INSERT OR IGNORE INTO cast (title_id, name, role) VALUES (?,?,?)').bind(id, name, role ?? null).run()
  return c.json({ ok: true })
})
app.put('/api/cast/:castId', async (c) => {
  const castId = Number(c.req.param('castId'))
  const { name, role } = await c.req.json()
  await c.env.DB.prepare('UPDATE cast SET name = ?, role = ? WHERE id = ?').bind(name, role ?? null, castId).run()
  return c.json({ ok: true })
})
app.delete('/api/cast/:castId', async (c) => {
  const castId = Number(c.req.param('castId'))
  await c.env.DB.prepare('DELETE FROM cast WHERE id = ?').bind(castId).run()
  return c.json({ ok: true })
})

// People: Crew
app.get('/api/titles/:id/crew', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM crew WHERE title_id = ? ORDER BY id DESC').bind(id).all()
  return c.json(rows.results)
})
app.post('/api/titles/:id/crew', async (c) => {
  const id = Number(c.req.param('id'))
  const { name, department } = await c.req.json()
  await c.env.DB.prepare('INSERT OR IGNORE INTO crew (title_id, name, department) VALUES (?,?,?)').bind(id, name, department ?? null).run()
  return c.json({ ok: true })
})
app.put('/api/crew/:crewId', async (c) => {
  const crewId = Number(c.req.param('crewId'))
  const { name, department } = await c.req.json()
  await c.env.DB.prepare('UPDATE crew SET name = ?, department = ? WHERE id = ?').bind(name, department ?? null, crewId).run()
  return c.json({ ok: true })
})
app.delete('/api/crew/:crewId', async (c) => {
  const crewId = Number(c.req.param('crewId'))
  await c.env.DB.prepare('DELETE FROM crew WHERE id = ?').bind(crewId).run()
  return c.json({ ok: true })
})

// Festivals
app.get('/api/titles/:id/festivals', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM festivals WHERE title_id = ? ORDER BY id DESC').bind(id).all()
  return c.json(rows.results)
})
app.post('/api/titles/:id/festivals', async (c) => {
  const id = Number(c.req.param('id'))
  const { festival_name, award, year } = await c.req.json()
  await c.env.DB.prepare('INSERT INTO festivals (title_id, festival_name, award, year) VALUES (?,?,?,?)').bind(id, festival_name, award ?? null, year ?? null).run()
  return c.json({ ok: true })
})
app.put('/api/festivals/:festId', async (c) => {
  const festId = Number(c.req.param('festId'))
  const { festival_name, award, year } = await c.req.json()
  await c.env.DB.prepare('UPDATE festivals SET festival_name=?, award=?, year=? WHERE id=?').bind(festival_name, award ?? null, year ?? null, festId).run()
  return c.json({ ok: true })
})
app.delete('/api/festivals/:festId', async (c) => {
  const festId = Number(c.req.param('festId'))
  await c.env.DB.prepare('DELETE FROM festivals WHERE id=?').bind(festId).run()
  return c.json({ ok: true })
})

// Seeding (dev helpers)
app.post('/api/seed-if-empty', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) as n FROM titles').first<any>()
  if ((row?.n || 0) > 0) return c.json({ ok: true, skipped: true })
  const r = await c.env.DB.prepare('INSERT INTO titles (name, status) VALUES (?, ?)').bind('The Last Lotus', 'incomplete').run()
  const id = r.meta.last_row_id
  await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'created_title', 'seed').run()
  return c.json({ ok: true, id })
})

app.post('/api/seed-sample', async (c) => {
  async function ensureTitle(name: string): Promise<number> {
    const existing = await c.env.DB.prepare('SELECT id FROM titles WHERE name = ?').bind(name).first<any>()
    if (existing?.id) return existing.id
    const r = await c.env.DB.prepare('INSERT INTO titles (name, status) VALUES (?, ?)').bind(name, 'incomplete').run()
    const id = r.meta.last_row_id
    await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'created_title', 'seed').run()
    return id
  }
  async function putImageToR2(key: string, url: string): Promise<{ size: number; type: string }>{
    const resp = await fetch(url)
    if (!resp.ok) throw new Error('fetch image failed')
    const ct = resp.headers.get('content-type') || 'image/jpeg'
    const ab = await resp.arrayBuffer()
    await c.env.R2?.put(key, ab, { httpMetadata: { contentType: ct }})
    return { size: ab.byteLength, type: ct }
  }
  async function upsertPoster(titleId: number, imageUrl: string){
    const key = `titles/${titleId}/artworks/poster-seed-${Date.now()}`
    const meta = await putImageToR2(key, imageUrl)
    await c.env.DB.prepare(`INSERT INTO artworks (title_id, kind, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?)
      ON CONFLICT(title_id, kind) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`)
      .bind(titleId, 'poster', key, 'uploaded', meta.size, meta.type).run()
  }

  const saigonId = await ensureTitle('Saigon Neon')
  await upsertPoster(saigonId, 'https://picsum.photos/400/600')

  const harborId = await ensureTitle('The Quiet Harbor')
  await upsertPoster(harborId, 'https://picsum.photos/400/600?2')

  // also ensure a basic avail so readiness can flip to ready when other elements present
  await c.env.DB.prepare('INSERT INTO avails (title_id, license_type, territories, start_date, end_date, exclusive) VALUES (?,?,?,?,?,?)')
    .bind(saigonId, 'avod', 'worldwide', '2025-01-01', null, 0).run().catch(()=>{})
  await c.env.DB.prepare('INSERT INTO avails (title_id, license_type, territories, start_date, end_date, exclusive) VALUES (?,?,?,?,?,?)')
    .bind(harborId, 'avod', 'US,CA,GB', '2025-01-01', null, 0).run().catch(()=>{})

  return c.json({ ok: true, ids: [saigonId, harborId] })
})

// Seed full demo content
app.post('/api/seed-full', async (c) => {
  async function ensureTitle(name: string): Promise<number> {
    const existing = await c.env.DB.prepare('SELECT id FROM titles WHERE name = ?').bind(name).first<any>()
    if (existing?.id) return existing.id
    const r = await c.env.DB.prepare('INSERT INTO titles (name, status) VALUES (?, ?)').bind(name, 'incomplete').run()
    const id = r.meta.last_row_id
    await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(id, 'created_title', 'seed-full').run()
    return id
  }
  async function putToR2(key: string, data: ArrayBuffer, contentType: string){
    await c.env.R2?.put(key, data, { httpMetadata: { contentType }})
    return { size: data.byteLength, type: contentType }
  }
  async function fetchToR2(key: string, url: string){
    const resp = await fetch(url)
    if(!resp.ok) throw new Error('fetch failed '+url)
    const ct = resp.headers.get('content-type') || 'application/octet-stream'
    const ab = await resp.arrayBuffer()
    await c.env.R2?.put(key, ab, { httpMetadata: { contentType: ct }})
    return { size: ab.byteLength, type: ct }
  }
  async function upsertArtwork(titleId: number, kind: string, imageUrl: string){
    const key = `titles/${titleId}/artworks/${kind}-seed-${Date.now()}`
    const meta = await fetchToR2(key, imageUrl)
    await c.env.DB.prepare(`INSERT INTO artworks (title_id, kind, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?)
      ON CONFLICT(title_id, kind) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`)
      .bind(titleId, kind, key, 'uploaded', meta.size, meta.type).run()
    await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(titleId, 'artwork_uploaded', kind).run()
  }
  async function upsertCaption(titleId: number, language: string, kind: string){
    const key = `titles/${titleId}/captions/${language}-${kind}-seed-${Date.now()}`
    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${language.toUpperCase()} ${kind}\n`
    const meta = await putToR2(key, new TextEncoder().encode(vtt).buffer, 'text/vtt')
    await c.env.DB.prepare(`INSERT INTO captions (title_id, language, kind, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(title_id, language, kind) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`)
      .bind(titleId, language, kind, key, 'uploaded', meta.size, meta.type).run()
    await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(titleId, 'captions_uploaded', `${language}/${kind}`).run()
  }
  async function upsertDocument(titleId: number, doc_type: string){
    const key = `titles/${titleId}/documents/${doc_type}-seed-${Date.now()}`
    const pdfUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
    const meta = await fetchToR2(key, pdfUrl)
    await c.env.DB.prepare(`INSERT INTO documents (title_id, doc_type, r2_key, status, size_bytes, content_type) VALUES (?,?,?,?,?,?)
      ON CONFLICT(title_id, doc_type) DO UPDATE SET r2_key=excluded.r2_key, status='uploaded', size_bytes=excluded.size_bytes, content_type=excluded.content_type`)
      .bind(titleId, doc_type, key, 'uploaded', meta.size, meta.type).run()
    await c.env.DB.prepare('INSERT INTO updates (title_id, event_type, info) VALUES (?,?,?)').bind(titleId, 'documents_uploaded', doc_type).run()
  }
  async function ensureAvail(titleId: number){
    const exists = await c.env.DB.prepare('SELECT id FROM avails WHERE title_id = ? LIMIT 1').bind(titleId).first<any>()
    if (exists?.id) return
    await c.env.DB.prepare('INSERT INTO avails (title_id, license_type, territories, start_date, end_date, exclusive) VALUES (?,?,?,?,?,?)')
      .bind(titleId, 'avod', 'worldwide', '2025-01-01', null, 0).run()
  }
  async function setProfile(titleId: number, data: any){
    await c.env.DB.prepare('INSERT OR IGNORE INTO title_profiles (title_id) VALUES (?)').bind(titleId).run()
    const cols = ['sales_title','synopsis','genres','format','spoken_language','runtime_minutes','release_date']
    const set = cols.map(k => `${k} = ?`).join(',')
    const vals = cols.map(k => data[k] ?? null)
    await c.env.DB.prepare(`UPDATE title_profiles SET ${set} WHERE title_id = ?`).bind(...vals, titleId).run()
  }
  async function addCast(titleId: number, entries: Array<{name:string, role?:string|null}>){
    for(const e of entries){ await c.env.DB.prepare('INSERT OR IGNORE INTO cast (title_id, name, role) VALUES (?,?,?)').bind(titleId, e.name, e.role??null).run() }
  }
  async function addCrew(titleId: number, entries: Array<{name:string, department?:string|null}>){
    for(const e of entries){ await c.env.DB.prepare('INSERT OR IGNORE INTO crew (title_id, name, department) VALUES (?,?,?)').bind(titleId, e.name, e.department??null).run() }
  }
  async function addFestivals(titleId: number, entries: Array<{festival_name:string, award?:string|null, year?:number|null}>){
    for(const e of entries){ await c.env.DB.prepare('INSERT INTO festivals (title_id, festival_name, award, year) VALUES (?,?,?,?)').bind(titleId, e.festival_name, e.award??null, e.year??null).run().catch(()=>{}) }
  }

  const titles = [
    { name: 'Saigon Neon', poster: 'https://picsum.photos/400/600', profile: { sales_title: 'Saigon Neon', synopsis: 'A neon-soaked chase through District 1.', genres: 'Thriller,Action', format: 'Movie', spoken_language: 'Vietnamese', runtime_minutes: 98, release_date: '2024-10-01' }, cast: [{name:'Anh Tran', role:'Lead'}, {name:'Mai Pham', role:'Detective'}], crew: [{name:'K. Nguyen', department:'Director'}, {name:'L. Truong', department:'Composer'}], fests: [{festival_name:'HCMC Film Fest', award:'Audience Award', year:2024}] },
    { name: 'The Quiet Harbor', poster: 'https://picsum.photos/400/600?2', profile: { sales_title: 'The Quiet Harbor', synopsis: 'A meditative drama set on a foggy coastline.', genres: 'Drama', format: 'Movie', spoken_language: 'English', runtime_minutes: 112, release_date: '2023-03-15' }, cast: [{name:'Evan Hall', role:'Fisherman'}], crew: [{name:'R. Cole', department:'Director'}], fests: [{festival_name:'Telluride', award:null, year:2023}] },
    { name: 'Lotus in the Storm', poster: 'https://picsum.photos/400/600?3', profile: { sales_title: 'Lotus in the Storm', synopsis: 'A family saga spanning Saigon to Orange County.', genres: 'Drama,Family', format: 'Movie', spoken_language: 'English/Vietnamese', runtime_minutes: 105, release_date: '2025-01-20' }, cast: [{name:'Kim Le', role:'Mother'}], crew: [{name:'D. Vu', department:'Director'}], fests: [{festival_name:'Busan', award:'Nominated', year:2024}] }
  ]

  const results: any[] = []
  for(const t of titles){
    const id = await ensureTitle(t.name)
    await upsertArtwork(id, 'poster', t.poster)
    await upsertCaption(id, 'en', 'subtitles')
    await upsertDocument(id, 'chain_of_title')
    await ensureAvail(id)
    await setProfile(id, t.profile)
    await addCast(id, t.cast)
    await addCrew(id, t.crew)
    await addFestivals(id, t.fests)
    results.push({ id, name: t.name })
  }

  return c.json({ ok: true, results })
})

// Licenses
app.get('/api/titles/:id/licenses', async (c) => {
  const id = Number(c.req.param('id'))
  const rows = await c.env.DB.prepare('SELECT * FROM licenses WHERE title_id = ? ORDER BY id DESC').bind(id).all()
  return c.json(rows.results)
})
app.post('/api/titles/:id/licenses', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const { channel = null, rights_granted = null, revenue_terms = null, start_date = null, end_date = null, agreement_url = null, status = 'draft' } = body || {}
  await c.env.DB.prepare('INSERT INTO licenses (title_id, channel, rights_granted, revenue_terms, start_date, end_date, agreement_url, status) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, channel, rights_granted, revenue_terms, start_date, end_date, agreement_url, status).run()
  return c.json({ ok: true })
})
app.put('/api/licenses/:licId', async (c) => {
  const licId = Number(c.req.param('licId'))
  const body = await c.req.json()
  const { channel = null, rights_granted = null, revenue_terms = null, start_date = null, end_date = null, agreement_url = null, status = null } = body || {}
  await c.env.DB.prepare('UPDATE licenses SET channel=?, rights_granted=?, revenue_terms=?, start_date=?, end_date=?, agreement_url=?, status=COALESCE(?, status) WHERE id=?')
    .bind(channel, rights_granted, revenue_terms, start_date, end_date, agreement_url, status, licId).run()
  return c.json({ ok: true })
})
app.delete('/api/licenses/:licId', async (c) => {
  const licId = Number(c.req.param('licId'))
  await c.env.DB.prepare('DELETE FROM licenses WHERE id = ?').bind(licId).run()
  return c.json({ ok: true })
})

// Updates
app.get('/api/updates', async (c) => {
  const { per_page = '10', title_id = '' } = c.req.query()
  const limit = Math.min(100, Math.max(1, parseInt(String(per_page), 10) || 10))
  const hasTitle = String(title_id||'').trim() !== ''
  const sql = `SELECT u.*, t.name AS title_name FROM updates u LEFT JOIN titles t ON t.id = u.title_id ${hasTitle?'WHERE u.title_id = ?':''} ORDER BY u.id DESC LIMIT ?`
  const args: any[] = []
  if (hasTitle) args.push(Number(title_id))
  args.push(limit)
  const rows = await c.env.DB.prepare(sql).bind(...args).all()
  return c.json(rows.results)
})

export default app
