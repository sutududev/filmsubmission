import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Bindings } from './types'
import api from './routes'

const app = new Hono<{ Bindings: Bindings }>()

// Static assets
app.use('/static/*', serveStatic({ root: './public' }))

// Optional ACCESS_CODE simple auth
app.use('*', async (c, next) => {
  const required = c.env.ACCESS_CODE
  if (!required) return next()
  const cookie = c.req.cookie('ACCESS_CODE')
  const header = c.req.header('x-access-code')
  if (cookie === required || header === required) return next()
  if (c.req.path === '/login') return next()
  return c.redirect('/login')
})

app.get('/login', (c) => {
  return c.html(`<!DOCTYPE html><html><head><meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1'>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="/static/styles.css" rel="stylesheet">
  <title>Login · filmsubmission</title></head>
  <body class='p-6'>
  <div class='max-w-md mx-auto bg-white p-6 rounded-xl border'>
    <h1 class='text-xl font-semibold mb-4'>Enter Access Code</h1>
    <form onsubmit="event.preventDefault(); document.cookie='ACCESS_CODE='+document.getElementById('code').value; location.href='/'">
      <input id='code' class='border p-2 rounded w-full mb-3' placeholder='ACCESS_CODE'>
      <button class='btn-primary'>Continue</button>
    </form>
  </div>
  </body></html>`)
})

// Helper layout
function pageLayout(title: string, inner: string, active: string){
  const li = (href: string, label: string, key: string) => `<a href='${href}' class='${active===key?'text-[var(--brand)]':''}'>${label}</a>`
  return `<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="/static/styles.css" rel="stylesheet">
  <title>${title} · filmsubmission</title></head>
  <body>
  <div class='min-h-screen grid grid-cols-12'>
    <aside class='col-span-12 md:col-span-3 lg:col-span-2 p-4'>
      <div class='logo'><img src='/static/logo.svg' width='28' height='28'/> <span class='font-bold'>filmsubmission</span></div>
      <nav class='flex flex-col gap-1 text-sm'>
        ${li('/', 'Overview', 'home')}
        ${li('/', 'Titles', 'titles')}
        ${li('/tasks', 'Tasks', 'tasks')}
        ${li('/requirements', 'Submission Requirements', 'requirements')}
        ${li('/insights', 'Insights', 'insights')}
        ${li('/statements', 'Statements', 'statements')}
        ${li('/schedule', 'Schedule', 'schedule')}
        ${li('/channels', 'Channels', 'channels')}
      </nav>
    </aside>
    <main class='col-span-12 md:col-span-9 lg:col-span-10 p-4'>${inner}</main>
  </div>
  <script src='/static/app.js'></script>
  </body></html>`
}

// Pages
app.get('/', (c) => {
  const inner = `
  <div class='flex items-center justify-between mb-3'>
    <div>
      <div class='text-xl font-bold'>My Titles</div>
      <div class='text-sm text-gray-600'>Submit films and delivery assets for distribution</div>
    </div>
    <button class='btn-primary' onclick='APP.createTitle()'>Create Title</button>
  </div>
  <div class='flex items-center gap-2 mb-3'>
    <input id='q' placeholder='Search titles' class='border p-2 rounded' oninput='APP.loadTitlesFiltered()'>
    <select id='status' class='border p-2 rounded' onchange='APP.loadTitlesFiltered()'>
      <option value=''>All</option><option>ready</option><option>incomplete</option>
    </select>
  </div>
  <div id='titles'></div>
  <div class='mt-6'>
    <div class='text-sm font-semibold mb-1'>Distribution Updates</div>
    <div id='updates' class='bg-white border rounded p-3'></div>
  </div>`
  return c.html(pageLayout('Overview', inner, 'home'))
})

app.get('/title/:id', (c) => {
  const id = c.req.param('id')
  const inner = `
    <div class='mb-3 flex items-center justify-between'>
      <div class='text-xl font-bold'>Title #${id}</div>
      <button class='btn-primary' onclick='APP.wizardOpen(${id})'>Open Wizard</button>
    </div>
    <div class='usage mb-3'><div id='usageBar' style='width:0%'></div></div>

    <div class='border-b mb-3 flex gap-3 text-sm'>
      <a href='#profile' class='tab' onclick='event.preventDefault(); location.hash="profile"'>Profile</a>
      <a href='#art' class='tab' onclick='event.preventDefault(); location.hash="art"'>Artwork</a>
      <a href='#cap' class='tab' onclick='event.preventDefault(); location.hash="cap"'>Captions</a>
      <a href='#doc' class='tab' onclick='event.preventDefault(); location.hash="doc"'>Documents</a>
      <a href='#people' class='tab' onclick='event.preventDefault(); location.hash="people"'>People</a>
      <a href='#av' class='tab' onclick='event.preventDefault(); location.hash="av"'>Avails</a>
      <a href='#licenses' class='tab' onclick='event.preventDefault(); location.hash="licenses"'>Licenses</a>
    </div>

    <section id='panel_profile' class='hidden'>
      <div class='grid grid-cols-1 md:grid-cols-2 gap-2'>
        <input id='pf_sales_title' class='border p-2 rounded' placeholder='Sales title'>
        <input id='pf_format' class='border p-2 rounded' placeholder='Format'>
        <input id='pf_spoken_language' class='border p-2 rounded' placeholder='Spoken language'>
        <input id='pf_runtime_minutes' class='border p-2 rounded' placeholder='Runtime (minutes)'>
        <input id='pf_release_date' class='border p-2 rounded' placeholder='Release date (YYYY-MM-DD)'>
        <input id='pf_genres' class='border p-2 rounded md:col-span-2' placeholder='Genres'>
        <textarea id='pf_synopsis' class='border p-2 rounded md:col-span-2' placeholder='Synopsis'></textarea>
      </div>
      <div class='text-right mt-2'><button class='btn-primary' onclick='APP.saveProfile(${id})'>Save</button></div>
    </section>

    <section id='panel_art' class='hidden'>
      <div id='artworks'></div>
      <form onsubmit='event.preventDefault(); APP.uploadMultipart("/api/titles/${id}/artworks", { kind: document.getElementById("art_kind").value }, document.getElementById("art_file")).then(()=>{ APP.loadArtworks(${id}); APP.loadUsage(${id}) })' class='mt-3 flex items-center gap-2'>
        <select id='art_kind' class='border rounded p-2'>
          <option>poster</option><option>landscape_16_9</option><option>portrait_2_3</option><option>banner</option>
        </select>
        <input id='art_file' type='file' accept='image/*' class='border p-2'/>
        <button class='btn-primary'>Upload</button>
      </form>
    </section>

    <section id='panel_cap' class='hidden'>
      <div id='captions'></div>
      <form onsubmit='event.preventDefault(); APP.uploadMultipart("/api/titles/${id}/captions", { language: document.getElementById("cap_lang").value, kind: document.getElementById("cap_kind").value }, document.getElementById("cap_file")).then(()=>{ APP.loadCaptions(${id}); APP.loadUsage(${id}) })' class='mt-3 flex items-center gap-2'>
        <input id='cap_lang' placeholder='en' class='border p-2 rounded' style='width:90px'>
        <select id='cap_kind' class='border rounded p-2'><option>subtitles</option><option>captions</option><option>sdh</option></select>
        <input id='cap_file' type='file' accept='.vtt,.srt' class='border p-2'/>
        <button class='btn-primary'>Upload</button>
      </form>
    </section>

    <section id='panel_doc' class='hidden'>
      <div id='documents'></div>
      <form onsubmit='event.preventDefault(); APP.uploadMultipart("/api/titles/${id}/documents", { doc_type: document.getElementById("doc_type").value }, document.getElementById("doc_file")).then(()=>{ APP.loadDocuments(${id}); APP.loadUsage(${id}) })' class='mt-3 flex items-center gap-2'>
        <select id='doc_type' class='border rounded p-2'>
          <option>chain_of_title</option><option>copyright_reg</option><option>eo_insurance</option><option>music_cue_sheet</option>
          <option>composer_agreement</option><option>talent_release</option><option>location_release</option><option>underlying_rights</option>
          <option>w9_w8</option><option>trailer_prores</option><option>screener</option><option>qc_report</option>
          <option>metadata_sheet</option><option>poster_psd</option><option>key_art_psd</option><option>delivery_schedule</option><option>other</option>
        </select>
        <input id='doc_file' type='file' accept='.pdf,.docx' class='border p-2'/>
        <button class='btn-primary'>Upload</button>
      </form>
    </section>

    <section id='panel_people' class='hidden'>
      <div class='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <div>
          <div class='font-semibold mb-1'>Cast</div>
          <div id='cast' class='bg-white border rounded'></div>
          <div class='mt-2 flex gap-2'>
            <input id='cast_name' class='border p-2 rounded' placeholder='Name'>
            <input id='cast_role' class='border p-2 rounded' placeholder='Role'>
            <button class='btn-primary' onclick='APP.addCast(${id})'>Add</button>
          </div>
        </div>
        <div>
          <div class='font-semibold mb-1'>Crew</div>
          <div id='crew' class='bg-white border rounded'></div>
          <div class='mt-2 flex gap-2'>
            <input id='crew_name' class='border p-2 rounded' placeholder='Name'>
            <input id='crew_dept' class='border p-2 rounded' placeholder='Department'>
            <button class='btn-primary' onclick='APP.addCrew(${id})'>Add</button>
          </div>
        </div>
        <div>
          <div class='font-semibold mb-1'>Festivals</div>
          <div id='festivals' class='bg-white border rounded'></div>
          <div class='mt-2 flex gap-2'>
            <input id='fest_name' class='border p-2 rounded' placeholder='Festival'>
            <input id='fest_award' class='border p-2 rounded' placeholder='Award (optional)'>
            <input id='fest_year' class='border p-2 rounded' placeholder='Year (optional)' style='width:120px'>
            <button class='btn-primary' onclick='APP.addFestival(${id})'>Add</button>
          </div>
        </div>
      </div>
    </section>

    <section id='panel_av' class='hidden'>
      <div id='avails'></div>
      <form onsubmit='event.preventDefault(); APP.createAvail(${id})' class='mt-3 flex items-center gap-2 flex-wrap'>
        <select id='av_type' class='border rounded p-2'><option value='avod'>avod</option><option value='svod'>svod</option><option value='tvod'>tvod</option></select>
        <input id='av_terr' placeholder='Territories (e.g., US,CA or worldwide)' class='border p-2 rounded'/>
        <input id='av_start' type='date' class='border p-2 rounded'/>
        <input id='av_end' type='date' class='border p-2 rounded'/>
        <label class='inline-flex items-center gap-2'><input id='av_excl' type='checkbox'/> Exclusive</label>
        <button class='btn-primary'>Add</button>
      </form>
    </section>

    <section id='panel_licenses' class='hidden'>
      <div id='licenses' class='bg-white border rounded'></div>
      <form id='lic_form' class='mt-3 grid grid-cols-1 md:grid-cols-2 gap-2' onsubmit='event.preventDefault(); (async ()=>{ const b={ channel:lic_channel.value, rights_granted:lic_rights.value, revenue_terms:lic_terms.value, start_date:lic_start.value, end_date:lic_end.value, agreement_url:lic_url.value, status:lic_status.value }; await fetch("/api/titles/${id}/licenses", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(b)}); alert("License added"); })()'>
        <input id='lic_channel' placeholder='Channel (e.g., Tubi, Prime Video)' class='border p-2 rounded'/>
        <input id='lic_rights' placeholder='Rights granted' class='border p-2 rounded'/>
        <input id='lic_terms' placeholder='Revenue terms' class='border p-2 rounded'/>
        <input id='lic_start' type='date' class='border p-2 rounded'/>
        <input id='lic_end' type='date' class='border p-2 rounded'/>
        <input id='lic_url' placeholder='Agreement URL (optional)' class='border p-2 rounded md:col-span-2'/>
        <select id='lic_status' class='border p-2 rounded'><option>draft</option><option>active</option><option>expired</option></select>
        <div class='md:col-span-2 text-right'><button class='btn-primary'>Add License</button></div>
      </form>
    </section>

    <div id='wizard-backdrop' class='modal-backdrop'><div id='wizard' class='modal'></div></div>

    <script>
      (function(){
        const id = ${id};
        const tabs = ['profile','art','cap','doc','people','av','licenses'];
        function showTab(){
          const h = (location.hash||'#profile').replace('#','');
          tabs.forEach(t=>{ const el=document.getElementById('panel_'+t); if(el) el.classList.toggle('hidden', t!==h) });
          document.querySelectorAll('.tab').forEach(a=>a.classList.remove('active'));
          const link = document.querySelector("a[href='#"+h+"']"); if(link) link.classList.add('active');
        }
        window.addEventListener('hashchange', showTab);
        showTab();
        APP.loadUsage(id); APP.loadArtworks(id); APP.loadCaptions(id); APP.loadDocuments(id); APP.loadAvails(id); APP.loadProfile(id); APP.loadCast(id); APP.loadCrew(id); APP.loadFestivals(id);
      })();
    </script>
  `
  return c.html(pageLayout('Title', inner, 'titles'))
})

app.get('/tasks', (c) => {
  const inner = `
  <div class='text-xl font-bold mb-3'>Tasks</div>
  <div id='tasks'></div>
  <script>APP.loadTasks()</script>
  `
  return c.html(pageLayout('Tasks', inner, 'tasks'))
})

app.get('/requirements', (c) => {
  const inner = `
  <div class='mb-3'>
    <div class='text-xl font-bold'>Submission Requirements</div>
    <div class='text-sm text-gray-600'>Filmhub-aligned technical standards. Use this checklist before delivery.</div>
  </div>
  <div id='req-checklist' class='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2'></div>
  `
  return c.html(pageLayout('Requirements', inner, 'requirements'))
})

app.get('/insights', (c) => c.html(pageLayout('Insights', `<div>Coming soon</div>`, 'insights')))
app.get('/statements', (c) => c.html(pageLayout('Statements', `<div>Coming soon</div>`, 'statements')))
app.get('/schedule', (c) => c.html(pageLayout('Schedule', `<div>Coming soon</div>`, 'schedule')))
app.get('/channels', (c) => c.html(pageLayout('Channels', `<div>Coming soon</div>`, 'channels')))

// Mount API last
app.route('/', api)

export default app
