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

// Admin: bootstrap schema (local/dev convenience)
const schemaSQL = `
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

api.post('/admin/bootstrap', async (c) => { await c.env.DB.exec(schemaSQL); return c.json({ ok: true }) })
api.get('/health', (c) => c.json({ ok: true }))

// Title usage
api.get('/titles/:id/usage', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return fail(c, 400, 'invalid title id')
  const used = await getTitleUsageBytes(c.env, id)
  return c.json({ used_bytes: used, quota_bytes: TITLE_QUOTA_BYTES, bytes_remaining: Math.max(0, TITLE_QUOTA_BYTES - used) })
})

// Titles
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
