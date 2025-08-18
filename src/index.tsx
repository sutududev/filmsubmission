import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { api } from './routes'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/static/*', serveStatic({ root: './public' }))

// Simple access-code auth (optional). Set ACCESS_CODE secret to enable.
app.use('*', async (c, next) => {
  const required = c.env.ACCESS_CODE
  if (!required) return next()
  const url = new URL(c.req.url)
  const path = url.pathname
  if (path.startsWith('/static/') || path === '/login' || path === '/api/health') return next()
  const hdr = c.req.header('x-access-code')
  if (hdr && hdr === required) return next()
  const cookie = c.req.header('Cookie') || ''
  const m = /(?:^|;\s*)ac=([^;]+)/.exec(cookie)
  const ac = m?.[1]
  if (ac === required) return next()
  if (path.startsWith('/api/')) return c.json({ error: 'unauthorized' }, 401)
  return c.redirect('/login')
})

app.post('/login', async (c) => {
  const required = c.env.ACCESS_CODE
  if (!required) return c.redirect('/')
  const ct = c.req.header('content-type') || ''
  let code = ''
  if (ct.includes('application/json')) {
    try { const body = await c.req.json<any>(); code = body.code || '' } catch {}
  } else {
    const form = await c.req.parseBody()
    // @ts-ignore
    code = (form?.code as string) || ''
  }
  if (code !== required) return c.html('<p style="font-family:ui-sans-serif">Invalid code. <a href="/login">Try again</a></p>', 401)
  const cookie = `ac=${required}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`
  return new Response(null, { status: 302, headers: { 'Set-Cookie': cookie, 'Location': '/' } })
})

app.get('/login', (c) => {
  return c.html(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><script src="https://cdn.tailwindcss.com"></script><title>Sign in</title></head><body class="bg-gray-50">
  <div class="min-h-screen flex items-center justify-center p-6"><form method="POST" action="/login" class="bg-white border rounded p-6 w-full max-w-sm space-y-3">
    <h1 class="text-xl font-semibold">Enter Access Code</h1>
    <input name="code" type="password" placeholder="Access code" class="border rounded p-2 w-full"/>
    <button class="w-full px-3 py-2 bg-blue-600 text-white rounded">Continue</button>
  </form></div>
</body></html>`)
})

app.route('/api', api)

app.get('/', (c) => {
  const inner = `
    <h1 class=\"text-2xl font-bold mb-4\">My Titles</h1>
    <div class=\"flex items-center gap-3 mb-4\">
      <button onclick=\"APP.createTitle()\" class=\"btn-primary\">Create Title</button>
      <a href=\"#\" onclick=\"APP.loadTitles()\" class=\"text-blue-600\">Refresh</a>
    </div>
    <div class=\"grid grid-cols-1 md:grid-cols-3 gap-6\">
      <div class=\"md:col-span-2\">
        <div class=\"flex items-center gap-2 mb-2\">
          <input id=\"q\" class=\"border rounded p-2 w-full\" placeholder=\"Filter by title name...\" onkeyup=\"APP.loadTitlesFiltered()\" />
          <select id=\"status\" class=\"border rounded p-2\" onchange=\"APP.loadTitlesFiltered()\">
            <option value=\"\">All</option>
            <option value=\"incomplete\">Incomplete</option>
            <option value=\"ready\">Ready</option>
          </select>
        </div>
        <div id=\"titles\"></div>
      </div>
      <div>
        <h2 class=\"font-semibold mb-2\">Distribution Updates</h2>
        <div id=\"updates\" class=\"bg-white border rounded p-3 text-sm text-gray-600\">No results.</div>
      </div>
    </div>
    <script src=\"/static/app.js\"></script>
    <script>
      APP.loadTitles();
      // Auto-seed example content if DB is empty
      (async ()=>{ try { const r=await fetch('/api/seed-if-empty', {method:'POST'}); if(r.ok){ APP.loadTitles(); } } catch(e){} })();
      // Optionally seed two more sample titles with tiny assets (idempotent)
      (async ()=>{ try { await fetch('/api/seed-sample', {method:'POST'}); APP.loadTitles(); } catch(e){} })();
    </script>
  `
  return c.html(pageLayout('Sutudu Film Submission', inner, 'overview'))
})

app.get('/title/:id', (c) => {
  const id = c.req.param('id')
  const inner = `
    <a href="/" class="text-blue-600">← Back</a>
    <h1 class="text-2xl font-bold mb-4">Title #${id}</h1>
    <div class="mb-4 flex items-center justify-between">
      <div class="flex-1 mr-3"><div class="usage"><div id="usageBar" style="width:0%"></div></div></div>
      <button class="btn-primary" onclick="APP.wizardOpen(${id})">Open Wizard</button>
    </div>
    <div class="flex gap-4 border-b mb-4">
      <a class="tab active" onclick="showTab('prof')">Profile</a>
      <a class="tab" onclick="showTab('art')">Artwork</a>
      <a class="tab" onclick="showTab('cap')">Captions</a>
      <a class="tab" onclick="showTab('doc')">Documents</a>
      <a class="tab" onclick="showTab('av')">Avails</a>
    </div>

    <div id="tab-prof">
      <div class="bg-white border rounded p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input id="pf_sales_title" placeholder="Sales title" class="border p-2 rounded" />
        <input id="pf_format" placeholder="Format (Movie/Series/etc)" class="border p-2 rounded" />
        <input id="pf_spoken_language" placeholder="Spoken language" class="border p-2 rounded" />
        <input id="pf_dubbed_languages" placeholder="Dubbed languages" class="border p-2 rounded" />
        <input id="pf_caption_languages" placeholder="Caption languages" class="border p-2 rounded" />
        <input id="pf_origin_country" placeholder="Origin country" class="border p-2 rounded" />
        <input id="pf_runtime_minutes" placeholder="Runtime (minutes)" class="border p-2 rounded" />
        <input id="pf_release_date" placeholder="Release date (YYYY-MM-DD)" class="border p-2 rounded" />
        <input id="pf_rating_system" placeholder="Rating system" class="border p-2 rounded" />
        <input id="pf_rating" placeholder="Rating" class="border p-2 rounded" />
        <input id="pf_production_company" placeholder="Production company" class="border p-2 rounded" />
        <input id="pf_website" placeholder="Website" class="border p-2 rounded" />
        <input id="pf_genres" placeholder="Genres (comma separated)" class="border p-2 rounded md:col-span-2" />
        <textarea id="pf_synopsis" placeholder="Synopsis" class="border p-2 rounded md:col-span-2"></textarea>
        <input id="pf_keywords" placeholder="Keywords" class="border p-2 rounded md:col-span-2" />
      </div>
      <div class="mt-3">
        <button class="btn-primary" onclick="APP.saveProfile(${id})">Save Profile</button>
      </div>
    </div>

    <div id="tab-art" style="display:none">
      <form onsubmit="event.preventDefault(); APP.uploadMultipart('/api/titles/${id}/artworks', {kind: document.getElementById('art_kind').value}, document.getElementById('art_file')).then(()=>{APP.loadArtworks(${id}); APP.loadUsage(${id})})" class="mb-3 flex items-center gap-2">
        <select id="art_kind" class="border rounded p-2">
          <option>poster</option>
          <option>landscape_16_9</option>
          <option>portrait_2_3</option>
          <option>banner</option>
        </select>
        <input id="art_file" type="file" accept="image/*" class="border p-2" />
        <button class="px-3 py-2 bg-blue-600 text-white rounded">Upload</button>
      </form>
      <div id="artworks" class="bg-white rounded border"></div>
    </div>

    <div id="tab-cap" style="display:none">
      <form onsubmit="event.preventDefault(); APP.uploadMultipart('/api/titles/${id}/captions', {language: document.getElementById('cap_lang').value, kind: document.getElementById('cap_kind').value}, document.getElementById('cap_file')).then(()=>{APP.loadCaptions(${id}); APP.loadUsage(${id})})" class="mb-3 flex items-center gap-2">
        <input id="cap_lang" placeholder="language (e.g., en)" class="border p-2" />
        <select id="cap_kind" class="border rounded p-2">
          <option>subtitles</option>
          <option>captions</option>
          <option>sdh</option>
        </select>
        <input id="cap_file" type="file" accept=".vtt,.srt" class="border p-2" />
        <button class="px-3 py-2 bg-blue-600 text-white rounded">Upload</button>
      </form>
      <div id="captions" class="bg-white rounded border"></div>
    </div>

    <div id="tab-doc" style="display:none">
      <form onsubmit="event.preventDefault(); APP.uploadMultipart('/api/titles/${id}/documents', {doc_type: document.getElementById('doc_type').value}, document.getElementById('doc_file')).then(()=>{APP.loadDocuments(${id}); APP.loadUsage(${id})})" class="mb-3 flex items-center gap-2">
        <select id="doc_type" class="border rounded p-2">
          <option>chain_of_title</option>
          <option>copyright_reg</option>
          <option>eo_insurance</option>
          <option>music_cue_sheet</option>
          <option>composer_agreement</option>
          <option>talent_release</option>
          <option>location_release</option>
          <option>underlying_rights</option>
          <option>w9_w8</option>
          <option>trailer_prores</option>
          <option>screener</option>
          <option>qc_report</option>
          <option>metadata_sheet</option>
          <option>poster_psd</option>
          <option>key_art_psd</option>
          <option>delivery_schedule</option>
          <option>other</option>
        </select>
        <input id="doc_file" type="file" accept=".pdf,.docx" class="border p-2" />
        <button class="px-3 py-2 bg-blue-600 text-white rounded">Upload</button>
      </form>
      <div id="documents" class="bg-white rounded border"></div>
    </div>

    <div id="tab-av" style="display:none">
      <form onsubmit="event.preventDefault(); APP.createAvail(${id})" class="mb-3 flex items-center gap-2 flex-wrap">
        <select id="av_type" class="border rounded p-2">
          <option value="avod">avod</option>
          <option value="svod">svod</option>
          <option value="tvod">tvod</option>
        </select>
        <input id="av_terr" placeholder="Territories (e.g., US,CA or worldwide)" class="border p-2 rounded" />
        <input id="av_start" type="date" class="border p-2 rounded" />
        <input id="av_end" type="date" class="border p-2 rounded" />
        <label class="inline-flex items-center gap-2"><input id="av_excl" type="checkbox"/> Exclusive</label>
        <button class="px-3 py-2 bg-blue-600 text-white rounded">Add</button>
      </form>
      <div id="avails" class="bg-white rounded border"></div>
    </div>

    <script src="/static/app.js"></script>
    <script>
      function showTab(key){
        const keys=['prof','art','cap','doc','av']
        for(const kid of keys){
          const el=document.getElementById('tab-'+kid)
          if(el) el.style.display = (kid===key)?'block':'none'
        }
        const tabs=document.querySelectorAll('.tab');
        tabs.forEach((t)=>{ t.classList.toggle('active', t.getAttribute('onclick')?.includes("'"+key+"'")) })
      }
      // Activate initial tab from location.hash if provided
      (function(){ const h=location.hash.replace('#',''); if(['prof','art','cap','doc','av'].includes(h)) showTab(h) })();
      APP.loadUsage(${id});
      APP.loadProfile(${id});
      APP.loadArtworks(${id});
      APP.loadCaptions(${id});
      APP.loadDocuments(${id});
      APP.loadAvails(${id});
    </script>
  `
  return c.html(pageLayout(`Title ${id}`, inner, 'titles'))
})

function pageLayout(title: string, inner: string, active: 'overview'|'titles'|'tasks'|'insights'|'statements'|'schedule'|'channels' = 'overview'){
  const cls = (key:string)=> `py-1 ${active===key? 'text-blue-600':''}`
  return `<!doctype html><html><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width, initial-scale=1'/><script src='https://cdn.tailwindcss.com'></script><link href='/static/styles.css' rel='stylesheet'><title>${title}</title></head><body class='bg-gray-50'><div class='min-h-screen flex'>
    <aside class='w-60 bg-white border-r p-4 space-y-2'>
      <div class='logo mb-3'><img src='/static/logo.svg' alt='Sutudu' width='96' height='24'/></div>
      <nav class='flex flex-col text-sm'>
        <a href='/' class='${cls("overview")}'>Overview</a>
        <a href='/' class='${cls('titles')}'>Titles</a>
        <a href='/tasks' class='${cls("tasks")}'>Tasks</a>
        <a href='/insights' class='${cls('insights')}'>Insights</a>
        <a href='/statements' class='${cls('statements')}'>Statements</a>
        <a href='/schedule' class='${cls('schedule')}'>Schedule</a>
        <a href='/channels' class='${cls('channels')}'>Channels</a>
      </nav>
    </aside>
    <main class='flex-1 p-6 max-w-6xl'>${inner}</main>
  </div></body></html>`
}

app.get('/insights', (c)=> c.html(pageLayout('Insights', `<h1 class='text-2xl font-bold mb-4'>Insights</h1><p class='text-gray-600'>Coming soon: performance graphs, channel breakdowns, regions, and engagement.</p>`)))
app.get('/statements', (c)=> c.html(pageLayout('Statements', `<h1 class='text-2xl font-bold mb-4'>Statements</h1><p class='text-gray-600'>Coming soon: financial statements, periods, and downloadable reports.</p>`)))
app.get('/schedule', (c)=> c.html(pageLayout('Schedule', `<h1 class='text-2xl font-bold mb-4'>Schedule</h1><p class='text-gray-600'>Coming soon: delivery timelines, QC windows, and release schedules.</p>`)))
app.get('/channels', (c)=> c.html(pageLayout('Channels', `<h1 class='text-2xl font-bold mb-4'>Channels</h1><p class='text-gray-600'>Coming soon: partner onboarding, submission status, and publishing.</p>`)))

app.get('/tasks', (c)=> c.html(pageLayout('Tasks', `
  <h1 class='text-2xl font-bold mb-4'>Tasks</h1>
  <div id='tasks' class='space-y-3'></div>
  <script src="/static/app.js"></script>
  <script>APP.loadTasks()</script>
`, 'tasks')))

export default app
