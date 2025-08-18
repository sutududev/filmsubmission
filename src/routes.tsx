import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { Bindings } from './types'

export const api = new Hono<{ Bindings: Bindings }>()

// Admin: bootstrap schema (local/dev convenience)
const schemaSQL = await (async () => {
  // Inline minimal subset for bootstrap; in prod use migrations apply
  return `
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`})()

api.post('/admin/bootstrap', async (c) => { await c.env.DB.exec(schemaSQL); return c.json({ ok: true }) })
api.get('/health', (c) => c.json({ ok: true }))

// Titles
api.get('/titles', async (c) => {
  const rs = await c.env.DB.prepare('SELECT id, name, status, created_at FROM titles ORDER BY id DESC').all()
  return c.json(rs.results)
})

api.post('/titles',
  validator('json', (value, c) => {
    if (!value?.name || typeof value.name !== 'string') return c.text('name is required', 400)
    return value
  }),
  async (c) => {
    const { name } = await c.req.json<{ name: string }>()
    const res = await c.env.DB.prepare('INSERT INTO titles (name) VALUES (?)').bind(name).run()
    return c.json({ id: res.meta.last_row_id, name, status: 'incomplete' }, 201)
  }
)
