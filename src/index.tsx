import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { api } from './routes'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/static/*', serveStatic({ root: './public' }))

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
    <link href="/static/styles.css" rel="stylesheet"></head>
    <body class="bg-gray-50">
      <div class="max-w-6xl mx-auto p-6">
        <h1 class="text-2xl font-bold mb-4">Sutudu Film Submission</h1>
        <div class="flex items-center gap-3 mb-4">
          <button onclick="APP.createTitle()" class="px-3 py-2 bg-blue-600 text-white rounded">Create Title</button>
          <a href="#" onclick="APP.loadTitles()" class="text-blue-600">Refresh</a>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="md:col-span-2">
            <div class="flex items-center gap-2 mb-2">
              <input id="q" class="border rounded p-2 w-full" placeholder="Filter by title name..." onkeyup="APP.loadTitlesFiltered()" />
              <select id="status" class="border rounded p-2" onchange="APP.loadTitlesFiltered()">
                <option value="">All</option>
                <option value="incomplete">Incomplete</option>
                <option value="ready">Ready</option>
              </select>
            </div>
            <div id="titles"></div>
          </div>
          <div>
            <h2 class="font-semibold mb-2">Distribution Updates</h2>
            <div id="updates" class="bg-white border rounded p-3 text-sm text-gray-600">No results.</div>
          </div>
        </div>
      </div>
      <script src="/static/app.js"></script>
      <script>APP.loadTitles()</script>
    </body>
    </html>
  `)
})

app.get('/title/:id', (c) => {
  const id = c.req.param('id')
  return c.html(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Title ${id}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="/static/styles.css" rel="stylesheet">
  </head>
  <body class="bg-gray-50">
    <div class="max-w-6xl mx-auto p-6">
      <a href="/" class="text-blue-600">← Back</a>
      <h1 class="text-2xl font-bold mb-4">Title #${id}</h1>
      <div class="mb-4">
        <div class="usage"><div id="usageBar" style="width:0%"></div></div>
      </div>
      <div class="flex gap-4 border-b mb-4">
        <a class="tab active" onclick="showTab('art')">Artwork</a>
        <a class="tab" onclick="showTab('cap')">Captions</a>
        <a class="tab" onclick="showTab('doc')">Documents</a>
      </div>

      <div id="tab-art">
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
    </div>

    <script src="/static/app.js"></script>
    <script>
      function showTab(key){
        for(const id of ['art','cap','doc']){
          document.getElementById('tab-'+id).style.display = (id===key)?'block':'none'
        }
        const tabs=document.querySelectorAll('.tab'); tabs.forEach((t,i)=>{ t.classList.toggle('active', ['art','cap','doc'][i]===key) })
      }
      APP.loadUsage(${id}); APP.loadArtworks(${id}); APP.loadCaptions(${id}); APP.loadDocuments(${id});
    </script>
  </body>
  </html>
  `)
})

export default app
