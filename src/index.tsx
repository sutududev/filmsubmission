import { Hono } from 'hono'
import { renderer } from './renderer'
import { serveStatic } from 'hono/cloudflare-workers'
import { api } from './routes'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/static/*', serveStatic({ root: './public' }))
app.use(renderer)

app.route('/api', api)

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Sutudu Film Submission</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50">
      <div class="max-w-6xl mx-auto p-6">
        <h1 class="text-2xl font-bold mb-4">Sutudu Film Submission</h1>
        <button id="createBtn" class="px-3 py-2 bg-blue-600 text-white rounded">Create Title</button>
        <pre id="out" class="mt-4 bg-white p-3 rounded border text-xs"></pre>
      </div>
      <script>
        async function refresh(){ const r=await fetch('/api/titles'); const d=await r.json(); out.textContent=JSON.stringify(d,null,2) }
        createBtn.onclick=async()=>{ const name=prompt('Title name?','New Title'); if(!name)return; await fetch('/api/titles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); refresh() }
        refresh()
      </script>
    </body>
    </html>
  `)
})

export default app
