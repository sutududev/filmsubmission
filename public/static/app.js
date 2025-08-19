async function api(path, opts={}){ const r=await fetch(path, opts); if(!r.ok){ const t=await r.text(); throw new Error(t||('HTTP '+r.status)) } return r.json() }
function h(el, attrs={}, ...children){ const e=document.createElement(el); for(const [k,v] of Object.entries(attrs||{})){ if(k==='class') e.className=v; else if(k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v); else e.setAttribute(k,v) } for(const c of children.flat()){ if(c==null) continue; if(typeof c==='string') e.appendChild(document.createTextNode(c)); else e.appendChild(c) } return e }

// Inline SVG icon helpers
function _svg(attrs){ const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); for(const [k,v] of Object.entries(attrs||{})){ s.setAttribute(k,String(v)) } return s }
function _path(d, extra={}){ const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', d); p.setAttribute('fill','none'); p.setAttribute('stroke','currentColor'); p.setAttribute('stroke-width','2'); p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-linejoin','round'); for(const [k,v] of Object.entries(extra)) p.setAttribute(k, String(v)); return p }
function svgArrowRight(){ const s=_svg({width:16,height:16,viewBox:'0 0 24 24'}); s.appendChild(_path('M5 12h14')); s.appendChild(_path('M12 5l7 7-7 7')); return s }
function svgPlus(){ const s=_svg({width:16,height:16,viewBox:'0 0 24 24'}); s.appendChild(_path('M12 5v14')); s.appendChild(_path('M5 12h14')); return s }
function svgCamera(){ const s=_svg({width:24,height:24,viewBox:'0 0 24 24'}); s.appendChild(_path('M3 7h4.5l2-2H14l2 2H21v12H3z')); s.appendChild(_path('M12 10a4 4 0 1 0 0.001 8.001A4 4 0 0 0 12 10z', {fill:'none'})); return s }

async function loadTitles(){ return loadTitlesFiltered() }


// Build requirements checklist items on requirements page if present
(function(){
  const container = document.getElementById('req-checklist');
  if(!container) return;
  const items = [
    'Use preferred mezzanine codecs (ProRes 422/422 HQ, DNxHR/HD).',
    'Acceptable containers: .mpg, .mpeg, .mov, .mp4, .ts, .mkv, .ogg',
    'Resolution: ≥ 640px width with even dimensions; use original resolution; avoid upscaling.',
    'Remove timecode tracks; begin and end with 1–2 seconds of black.',
    'No interlacing, letterboxing, watermarks, or burned-in subtitles (except partial translations).',
    'Recommended frame rates: native project rate (typically 23.976/24/25/29.97).',
    'Audio: 48 kHz 16-bit PCM minimum; AAC/MP3 ≥128 kbps; stereo required; optional 5.1.',
    'No clipping, phasing, or distortion; meet recommended loudness.',
    'Provide aspect ratios: 2:3, 3:4, 16:9, 4:3, 2:1, 16:6, and 16:9 textless.',
    'Ensure title readability; match title exactly; consistent imagery and fonts.',
    'Avoid collages, borders, plain solid backgrounds, or promotional text/logos.',
    'No nudity/excessive violence imagery; respect safe area guidelines.',
    'English SDH captions required (SRT).',
    'Max 43 chars/line; max 2 lines; proper punctuation; legible timing.',
    'Caption durations and spacing within common QC ranges.',
    'Runtime: minimum 2 minutes; AVOD recommended total runtime >20 minutes.',
    'Series: submit all episodes for a season; at least 2 episodes per season.',
    'Prohibited: pornography, hate speech, unlawful/deceptive content, harm to people/animals.',
    'Restricted: promotional or home videos; no 3D/VR content.',
    'Trailer length ≤6 minutes (recommended ~2.5 minutes).',
    'Avoid sensitive content in trailers (nudity/sex/language/drugs/violence).',
    'Maintain professional image, color, sound, and editorial quality.'
  ];
  for(const label of items){
    const id = 'req_'+btoa(label).replace(/[^a-z0-9]/gi,'');
    const row = h('div',{class:'p-2 border rounded bg-white flex items-center gap-2'}, h('input',{type:'checkbox', id}), h('label',{for:id, class:'text-sm'}, label));
    container.appendChild(row)
  }
})();
async function loadTitlesFiltered(){
  const q=document.getElementById('q')?.value||''; const s=document.getElementById('status')?.value||'';
  const list=await api(`/api/titles?q=${encodeURIComponent(q)}&status=${encodeURIComponent(s)}`);
  const wrap=document.getElementById('titles'); wrap.innerHTML='';
  if(!list.length){
    const empty=h('div',{class:'empty'},
      h('div',{class:'title'},'No titles yet'),
      h('div',{class:'desc'},'Create your first title to start uploading artwork, captions, and documents.'),
      h('button',{class:'btn-primary', onclick:()=>APP.createTitle()}, svgPlus(), ' Create Title')
    );
    wrap.appendChild(empty); loadUpdates(); return;
  }
  const ul=h('div',{class:'grid grid-cols-1 gap-3'});
  list.forEach(t=>{
    const thumb = t.poster_key
      ? h('img',{src:`/api/file/${t.poster_key}`, class:'w-16 h-16 object-cover bg-gray-100 rounded-md'})
      : h('div',{class:'w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center text-gray-400'}, svgCamera());
    const statusVal = t.computed_status || t.status || 'incomplete';
    const badgeColor = statusVal==='ready' ? 'bg-green-100 text-green-700' : statusVal==='incomplete' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700';
    const status=h('span',{class:`px-2 py-0.5 rounded text-xs ${badgeColor}`}, statusVal);
    const left=h('div',{class:'flex items-center gap-3'}, thumb,
      h('div',{}, h('div',{class:'font-semibold text-lg'}, t.name), h('div',{class:'text-xs text-gray-500 flex items-center gap-2'}, `#${t.id}`, status))
    );
    const open=h('a',{href:`/title/${t.id}`, class:'btn-primary'}, 'Open', svgArrowRight());
    const li=h('div',{class:'p-4 flex items-center justify-between bg-white border rounded-xl shadow-sm'}, left, open);
    ul.appendChild(li)
  });
  wrap.appendChild(ul); loadUpdates();
}
async function loadUpdates(){ const list=await api('/api/updates?per_page=10'); const box=document.getElementById('updates'); if(!box) return; box.innerHTML=''; const table=h('div',{}); const header=h('div',{class:'grid grid-cols-3 text-xs text-gray-600 px-3 py-2 border-b bg-gray-50'}, 'Last Update','Channel','Title'); table.appendChild(header); if(!list.length){ const empty=h('div',{class:'p-4 text-sm text-gray-600'}, 'No results.'); table.appendChild(empty); box.appendChild(table); return } list.forEach(u=>{ const row=h('div',{class:'grid grid-cols-3 px-3 py-2 text-sm border-b'}, new Date(u.created_at).toLocaleString(), u.channel||'—', u.title_id?('#'+u.title_id):'—'); table.appendChild(row) }); box.appendChild(table) }

async function createTitle(){ const name=prompt('Title name?','New Title'); if(!name) return; await api('/api/titles',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name}) }); await loadTitles() }

async function loadUsage(id){ const u=await api(`/api/titles/${id}/usage`); const bar=document.getElementById('usageBar'); const pct=Math.min(100, Math.round(u.used_bytes*100/u.quota_bytes)); bar.style.width=pct+'%'; bar.textContent=`${(u.used_bytes/1024/1024).toFixed(1)}MB / ${(u.quota_bytes/1024/1024).toFixed(0)}MB`; }

async function loadArtworks(id){
  const rows=await api(`/api/titles/${id}/artworks`); const wrap=document.getElementById('artworks'); wrap.innerHTML='';
  if(!rows.length){
    const empty=h('div',{class:'empty'},
      h('div',{class:'title'},'No artwork yet'),
      h('div',{class:'desc'},'Poster, landscape 16:9, banner. JPG/PNG/WebP up to 10MB.'),
      h('button',{class:'btn-primary', onclick:()=>APP.wizardOpen(id)}, svgPlus(), ' Upload via Wizard')
    );
    wrap.appendChild(empty); APP.renderReadiness(id); return;
  }
  const grid=h('div',{class:'grid grid-cols-2 md:grid-cols-4 gap-4 p-3'});
  rows.forEach(r=>{ const statusChip=h('span',{class:`inline-block px-2 py-0.5 rounded text-xs ${r.status==='approved'?'bg-green-100 text-green-700':r.status==='rejected'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-700'}`}, r.status||'uploaded'); const actions=h('div',{}, h('a',{href:`/api/file/${r.r2_key}`, class:'text-blue-600 mr-3'},'view'), h('button',{class:'text-green-700 mr-2', onclick: async ()=>{ await api(`/api/artworks/${r.id}/status`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'approved'}) }); loadArtworks(id)}},'approve'), h('button',{class:'text-amber-700 mr-3', onclick: async ()=>{ await api(`/api/artworks/${r.id}/status`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'rejected'}) }); loadArtworks(id)}},'reject'), h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/artworks/${r.id}`,{method:'DELETE'}); loadArtworks(id); loadUsage(id) }},'delete')); const card=h('div',{class:'border rounded bg-white p-2 flex flex-col items-center'}, h('div',{class:'text-xs text-gray-600 self-start mb-1 flex items-center gap-2'}, r.kind, statusChip), h('img',{src:`/api/file/${r.r2_key}`, class:'w-40 h-60 object-cover bg-gray-100 border rounded', alt:r.kind}), h('div',{class:'mt-2 text-xs text-gray-500'}, `${(r.size_bytes||0)/1024|0} KB`), h('div',{class:'mt-2'}, actions)); grid.appendChild(card) }); wrap.appendChild(grid); APP.renderReadiness(id) }

async function loadCaptions(id){
  const rows=await api(`/api/titles/${id}/captions`); const wrap=document.getElementById('captions'); wrap.innerHTML='';
  if(!rows.length){
    const empty=h('div',{class:'empty'},
      h('div',{class:'title'},'No captions yet'),
      h('div',{class:'desc'},'Upload .vtt or .srt up to 2MB. Add multiple languages for reach.'),
      h('button',{class:'btn-primary', onclick:()=>document.getElementById('cap_file')?.click()}, svgPlus(), ' Upload Caption')
    );
    wrap.appendChild(empty); APP.renderReadiness(id); return;
  }
  rows.forEach(r=>{ const row=h('div',{class:'flex items-center justify-between p-2 border-b'}, h('div',{}, `${r.language}/${r.kind} · ${(r.size_bytes||0)/1024|0} KB`), h('div',{}, h('a',{href:`/api/file/${r.r2_key}`, class:'text-blue-600 mr-3'},'view'), h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/captions/${r.id}`,{method:'DELETE'}); loadCaptions(id); loadUsage(id) }},'delete'))); wrap.appendChild(row) })
}

const DOC_TYPES=["chain_of_title","copyright_reg","eo_insurance","music_cue_sheet","composer_agreement","talent_release","location_release","underlying_rights","w9_w8","trailer_prores","screener","qc_report","metadata_sheet","poster_psd","key_art_psd","delivery_schedule","other"];
async function loadDocuments(id){ const rows=await api(`/api/titles/${id}/documents`); const wrap=document.getElementById('documents'); wrap.innerHTML=''; if(!rows.length){ const empty=h('div',{class:'empty'}, h('div',{class:'title'},'No documents yet'), h('div',{class:'desc'},'Upload chain-of-title and delivery paperwork (PDF/DOCX up to 20MB).'), h('button',{class:'btn-primary', onclick:()=>document.getElementById('doc_file')?.click()}, svgPlus(), ' Upload Document')); wrap.appendChild(empty); return } // Uploaded list
rows.forEach(r=>{ const statusChip=h('span',{class:`inline-block px-2 py-0.5 rounded text-xs ${r.status==='approved'?'bg-green-100 text-green-700':r.status==='rejected'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-700'}`}, r.status||'uploaded'); const actions=h('div',{}, h('a',{href:`/api/file/${r.r2_key}`, class:'text-blue-600 mr-3'},'view'), h('button',{class:'text-green-700 mr-2', onclick: async ()=>{ await api(`/api/documents/${r.id}/status`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'approved'}) }); loadDocuments(id)}},'approve'), h('button',{class:'text-amber-700 mr-3', onclick: async ()=>{ await api(`/api/documents/${r.id}/status`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'rejected'}) }); loadDocuments(id)}},'reject'), h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/documents/${r.id}`,{method:'DELETE'}); loadDocuments(id); loadUsage(id) }},'delete'));
  const row=h('div',{class:'flex items-center justify-between p-2 border-b'}, h('div',{}, `${r.doc_type} · ${(r.size_bytes||0)/1024|0} KB `, statusChip), actions); wrap.appendChild(row) })
// Checklist
const have=new Set(rows.map(r=>r.doc_type)); const checklist=h('div',{class:'mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2'}); DOC_TYPES.forEach(t=>{ const ok=have.has(t); const chip=h('span',{class:`inline-block px-2 py-0.5 rounded text-xs ${ok?'bg-green-100 text-green-700':'bg-gray-100 text-gray-700'}`}, ok?'present':'missing'); const item=h('div',{class:'p-2 border rounded bg-white flex items-center justify-between'}, h('span',{}, t), chip); checklist.appendChild(item) }); wrap.appendChild(h('div',{class:'mt-2 text-sm text-gray-600'}, 'Checklist (optional):')); wrap.appendChild(checklist); APP.renderReadiness(id) }

async function uploadMultipart(url, fields, fileInput){ const fd=new FormData(); for(const [k,v] of Object.entries(fields)) fd.append(k,v); const f=fileInput.files[0]; if(!f) return alert('Select a file'); fd.append('file', f, f.name); await api(url,{ method:'POST', body:fd }); fileInput.value=''; }

async function saveProfile(id){ const body={}; ['sales_title','synopsis','genres','keywords','format','spoken_language','dubbed_languages','caption_languages','origin_country','runtime_minutes','release_date','rating_system','rating','production_company','website'].forEach(k=>{ const el=document.getElementById('pf_'+k); if(el) body[k]=el.value||null }); await api(`/api/titles/${id}/profile`,{ method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); alert('Saved'); }
async function loadProfile(id){ const p=await api(`/api/titles/${id}/profile`); const set=(k,v='')=>{ const el=document.getElementById('pf_'+k); if(el) el.value=v||'' }; if(p){ Object.entries(p).forEach(([k,v])=>{ if(k!=='title_id') set(k, v) }) }
 }
async function loadAvails(id){ const rows=await api(`/api/titles/${id}/avails`); const wrap=document.getElementById('avails'); wrap.innerHTML=''; rows.forEach(r=>{ const actions=h('div',{}, h('button',{class:'text-blue-600 mr-3', onclick: ()=>APP.editAvail(id, r)},'edit'), h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/avails/${r.id}`,{method:'DELETE'}); loadAvails(id); APP.renderReadiness(id)}},'delete')); const row=h('div',{class:'flex items-center justify-between p-2 border-b'}, `${r.license_type} · ${r.territories} · ${r.start_date} - ${r.end_date||''} ${r.exclusive?'(exclusive)':''}`, actions); wrap.appendChild(row) }) }
async function createAvail(id){ const license_type=document.getElementById('av_type').value; const territories=document.getElementById('av_terr').value; const start_date=document.getElementById('av_start').value; const end_date=document.getElementById('av_end').value||null; const exclusive=document.getElementById('av_excl').checked; await api(`/api/titles/${id}/avails`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ license_type, territories, start_date, end_date, exclusive }) }); document.getElementById('av_terr').value=''; loadAvails(id); APP.renderReadiness(id)}

async function editAvail(titleId, r){
  const license_type = prompt('license_type (avod/svod/tvod)', r.license_type) || r.license_type;
  const territories = prompt('territories', r.territories) || r.territories;
  const start_date = prompt('start_date (YYYY-MM-DD)', r.start_date) || r.start_date;
  const end_date = prompt('end_date (YYYY-MM-DD or empty)', r.end_date||'');
  const exclusive = confirm('Exclusive? OK=yes, Cancel=no');
  await api(`/api/avails/${r.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ license_type, territories, start_date, end_date: end_date||null, exclusive })});
  loadAvails(titleId)
}

// Wizard modal UI
function wizardOpen(id){ const m=document.getElementById('wizard'); if(!m){ buildWizardShell(); } renderWizard(parseInt(id,10)); document.getElementById('wizard-backdrop').classList.add('modal-backdrop','show'); }
function wizardClose(){ const b=document.getElementById('wizard-backdrop'); if(b) b.className='modal-backdrop'; }
function buildWizardShell(){ const b=document.createElement('div'); b.id='wizard-backdrop'; b.className='modal-backdrop'; const panel=document.createElement('div'); panel.className='modal'; panel.id='wizard'; b.appendChild(panel); document.body.appendChild(b) }
const WIZ_STEPS=[
  { key:'profile', title:'Profile', tip:'Basic metadata used by distributors.', example:'Sales title, synopsis, genres, languages, runtime, release date.' },
  { key:'artwork', title:'Artwork', tip:'Poster and key art. Keep it clean and legible.', example:'Poster (2:3), Landscape 16:9, Banner. JPG/PNG/WebP up to 10MB.' },
  { key:'captions', title:'Captions', tip:'Accessibility and localization files.', example:'English .vtt subtitles; additional languages welcome.' },
  { key:'documents', title:'Documents', tip:'Chain-of-title and delivery paperwork.', example:'COC/Chain-of-Title, E&O, Music cue sheet, Talent releases, W-9/W-8.' },
  { key:'avails', title:'Avails', tip:'Where and how you can license.', example:'AVOD worldwide, exclusive = no; or specific regions with start/end dates.' }
]
function renderWizard(id){ const el=document.getElementById('wizard'); if(!el) return; let stepIdx=parseInt(el.getAttribute('data-step')||'0',10); if(isNaN(stepIdx)) stepIdx=0; const step=WIZ_STEPS[stepIdx]; const dots=WIZ_STEPS.map((s,i)=>`<div style="height:4px;border-radius:2px;background:${i<=stepIdx?'#2563eb':'#e5e7eb'};flex:1;margin-right:4px"></div>`).join(''); const info=`<div class="info"><div class="font-semibold">${step.title} <span title="${step.tip} ${step.example}" style="cursor:help;color:#2563eb">(i)</span></div><div class="text-sm">${step.tip} <span class="text-gray-600">Example: ${step.example}</span></div></div>`;
  let body='';
  if(step.key==='profile') body=`<div class='grid grid-cols-1 md:grid-cols-2 gap-2'>
    <input id='pf_sales_title' class='border p-2 rounded' placeholder='Sales title'>
    <input id='pf_format' class='border p-2 rounded' placeholder='Format (Movie/Series/etc)'>
    <input id='pf_spoken_language' class='border p-2 rounded' placeholder='Spoken language'>
    <input id='pf_runtime_minutes' class='border p-2 rounded' placeholder='Runtime (minutes)'>
    <input id='pf_release_date' class='border p-2 rounded' placeholder='Release date (YYYY-MM-DD)'>
    <input id='pf_genres' class='border p-2 rounded md:col-span-2' placeholder='Genres (comma separated)'>
    <textarea id='pf_synopsis' class='border p-2 rounded md:col-span-2' placeholder='Synopsis'></textarea>
  </div><div class='text-right mt-2'><button class='px-3 py-2 bg-blue-600 text-white rounded' onclick='APP.saveProfile(${id})'>Save & Continue</button></div>`
  if(step.key==='artwork') body=`<form onsubmit='event.preventDefault(); APP.uploadMultipart("/api/titles/${id}/artworks", {kind: document.getElementById("w_art_kind").value}, document.getElementById("w_art_file")).then(()=>{ APP.loadArtworks(${id}); nextStep() })' class='flex items-center gap-2'>
      <select id='w_art_kind' class='border rounded p-2'><option>poster</option><option>landscape_16_9</option><option>portrait_2_3</option><option>banner</option></select>
      <input id='w_art_file' type='file' accept='image/*' class='border p-2'/>
      <button class='px-3 py-2 bg-blue-600 text-white rounded'>Upload & Continue</button>
    </form>`
  if(step.key==='captions') body=`<form onsubmit='event.preventDefault(); APP.uploadMultipart("/api/titles/${id}/captions", {language: document.getElementById("w_cap_lang").value, kind: document.getElementById("w_cap_kind").value}, document.getElementById("w_cap_file")).then(()=>{ APP.loadCaptions(${id}); nextStep() })' class='flex items-center gap-2'>
      <input id='w_cap_lang' placeholder='language (e.g., en)' class='border p-2'/>
      <select id='w_cap_kind' class='border rounded p-2'><option>subtitles</option><option>captions</option><option>sdh</option></select>
      <input id='w_cap_file' type='file' accept='.vtt,.srt' class='border p-2'/>
      <button class='px-3 py-2 bg-blue-600 text-white rounded'>Upload & Continue</button>
    </form>`
  if(step.key==='documents') body=`<form onsubmit='event.preventDefault(); APP.uploadMultipart("/api/titles/${id}/documents", {doc_type: document.getElementById("w_doc_type").value}, document.getElementById("w_doc_file")).then(()=>{ APP.loadDocuments(${id}); nextStep() })' class='flex items-center gap-2 flex-wrap'>
      <select id='w_doc_type' class='border rounded p-2'>${DOC_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
      <input id='w_doc_file' type='file' accept='.pdf,.docx' class='border p-2'/>
      <button class='px-3 py-2 bg-blue-600 text-white rounded'>Upload & Continue</button>
    </form>`
  if(step.key==='avails') body=`<form onsubmit='event.preventDefault(); APP.createAvail(${id}); nextStep()' class='flex items-center gap-2 flex-wrap'>
      <select id='av_type' class='border rounded p-2'><option value='avod'>avod</option><option value='svod'>svod</option><option value='tvod'>tvod</option></select>
      <input id='av_terr' placeholder='Territories (e.g., US,CA or worldwide)' class='border p-2 rounded'/>
      <input id='av_start' type='date' class='border p-2 rounded'/>
      <input id='av_end' type='date' class='border p-2 rounded'/>
      <label class='inline-flex items-center gap-2'><input id='av_excl' type='checkbox'/> Exclusive</label>
      <button class='px-3 py-2 bg-blue-600 text-white rounded'>Add & Finish</button>
    </form>`
  el.setAttribute('data-step', String(stepIdx));
  el.innerHTML = `<div class='p-4'>
    <div class='text-sm text-gray-500 mb-2 flex'>${dots}</div>
    <div class='text-xl font-bold mb-2'>${stepIdx+1}. ${step.title}</div>
    ${info}
    <div class='mt-3'>${body}</div>
    <div class='flex justify-between mt-4'>
      <button class='text-gray-600' onclick='prevStep()' ${stepIdx===0?'disabled':''}>Back</button>
      <button class='text-gray-600' onclick='wizardClose()'>Close</button>
      <button class='text-blue-600' onclick='nextStep()' ${stepIdx===WIZ_STEPS.length-1?'disabled':''}>Next</button>
    </div>
  </div>`
}
function nextStep(){ const el=document.getElementById('wizard'); if(!el) return; let i=parseInt(el.getAttribute('data-step')||'0',10); i=Math.min(WIZ_STEPS.length-1, i+1); el.setAttribute('data-step', String(i)); const id=(new URL(location.href)).pathname.split('/').pop(); renderWizard(parseInt(id,10)); }
function prevStep(){ const el=document.getElementById('wizard'); if(!el) return; let i=parseInt(el.getAttribute('data-step')||'0',10); i=Math.max(0, i-1); el.setAttribute('data-step', String(i)); const id=(new URL(location.href)).pathname.split('/').pop(); renderWizard(parseInt(id,10)); }

async function loadTasks(){
  const wrap=document.getElementById('tasks'); if(!wrap) return; wrap.innerHTML='Loading...';
  try{
    const titles=await api('/api/titles?per_page=50');
    if(!titles.length){ wrap.innerHTML='<div class="text-gray-600">No titles yet.</div>'; return }
    const container=h('div',{class:'space-y-4'});
    for(const t of titles){
      const [arts, caps, docs, avs] = await Promise.all([
        api(`/api/titles/${t.id}/artworks`),
        api(`/api/titles/${t.id}/captions`),
        api(`/api/titles/${t.id}/documents`),
        api(`/api/titles/${t.id}/avails`)
      ]);
      const havePoster = arts.some(a=>a.kind==='poster' && a.status!=='missing');
      const haveChain = docs.some(d=>d.doc_type==='chain_of_title' && d.status!=='missing');
      const haveEN = caps.some(c=>c.language==='en' && c.kind==='subtitles' && c.status!=='missing');
      const haveAvail = avs.length>0;
      const tasks=[];
      if(!havePoster) tasks.push({label:'Upload Poster (2:3 JPG/PNG/WebP)', href:`/title/${t.id}#art`});
      if(!haveEN) tasks.push({label:'Add English Subtitles (.vtt/.srt)', href:`/title/${t.id}#cap`});
      if(!haveChain) tasks.push({label:'Upload Chain-of-Title PDF', href:`/title/${t.id}#doc`});
      if(!haveAvail) tasks.push({label:'Create an Avail', href:`/title/${t.id}#av`});
      const card=h('div',{class:'border rounded bg-white p-3'},
        h('div',{class:'font-semibold mb-2'}, `${t.name} (#${t.id})`),
        tasks.length? h('ul',{class:'list-disc pl-5 space-y-1'}, ...tasks.map(it=> h('li',{}, h('a',{href:it.href, class:'text-blue-600'}, it.label))))
                    : h('div',{class:'text-sm text-green-700'}, 'All set for basic submission.'));
      container.appendChild(card)
    }
    wrap.innerHTML=''; wrap.appendChild(container);
  }catch(e){ wrap.textContent='Failed to load tasks.' }
}

async function loadCast(id){ const rows=await api(`/api/titles/${id}/cast`); const wrap=document.getElementById('cast'); wrap.innerHTML=''; rows.forEach(r=>{ const actions=h('div',{}, h('button',{class:'text-blue-600 mr-3', onclick: async ()=>{ const name=prompt('Name', r.name)||r.name; const role=prompt('Role', r.role||'')||r.role||null; await api(`/api/cast/${r.id}`,{method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, role })}); loadCast(id) }},'edit'), h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/cast/${r.id}`,{method:'DELETE'}); loadCast(id) }},'delete')); const row=h('div',{class:'flex items-center justify-between p-2 border-b'}, `${r.name} · ${r.role||''}`, actions); wrap.appendChild(row) }) }
async function addCast(id){ const name=document.getElementById('cast_name').value; const role=document.getElementById('cast_role').value; if(!name) return; await api(`/api/titles/${id}/cast`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, role }) }); document.getElementById('cast_name').value=''; document.getElementById('cast_role').value=''; loadCast(id) }
async function loadCrew(id){ const rows=await api(`/api/titles/${id}/crew`); const wrap=document.getElementById('crew'); wrap.innerHTML=''; rows.forEach(r=>{ const row=h('div',{class:'flex items-center justify-between p-2 border-b'}, `${r.name} · ${r.department||''}`, h('div',{}, h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/crew/${r.id}`,{method:'DELETE'}); loadCrew(id) }},'delete'))); wrap.appendChild(row) }) }
async function addCrew(id){ const name=document.getElementById('crew_name').value; const department=document.getElementById('crew_dept').value; if(!name) return; await api(`/api/titles/${id}/crew`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, department }) }); document.getElementById('crew_name').value=''; document.getElementById('crew_dept').value=''; loadCrew(id) }
async function loadFestivals(id){ const rows=await api(`/api/titles/${id}/festivals`); const wrap=document.getElementById('festivals'); wrap.innerHTML=''; rows.forEach(r=>{ const row=h('div',{class:'flex items-center justify-between p-2 border-b'}, `${r.festival_name}${r.award?(' · '+r.award):''}${r.year?(' · '+r.year):''}`, h('div',{}, h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/festivals/${r.id}`,{method:'DELETE'}); loadFestivals(id) }},'delete'))); wrap.appendChild(row) }) }
async function addFestival(id){ const festival_name=document.getElementById('fest_name').value; const award=document.getElementById('fest_award').value||null; const yearVal=document.getElementById('fest_year').value; const year=yearVal?parseInt(yearVal,10):null; if(!festival_name) return; await api(`/api/titles/${id}/festivals`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ festival_name, award, year }) }); document.getElementById('fest_name').value=''; document.getElementById('fest_award').value=''; document.getElementById('fest_year').value=''; loadFestivals(id) }

async function loadLicenses(id){ const rows=await api(`/api/titles/${id}/licenses`); const wrap=document.getElementById('licenses'); if(!wrap) return; wrap.innerHTML=''; if(!rows.length){ wrap.innerHTML='<div class="p-3 text-sm text-gray-600">No licenses yet.</div>'; return } rows.forEach(r=>{ const actions=h('div',{}, h('button',{class:'text-blue-600 mr-3', onclick: async ()=>{ const channel=prompt('Channel', r.channel||'')||r.channel; const rights_granted=prompt('Rights granted', r.rights_granted||'')||r.rights_granted; const revenue_terms=prompt('Revenue terms', r.revenue_terms||'')||r.revenue_terms; const start_date=prompt('Start date YYYY-MM-DD', r.start_date||'')||r.start_date; const end_date=prompt('End date YYYY-MM-DD or empty', r.end_date||''); const agreement_url=prompt('Agreement URL', r.agreement_url||'')||r.agreement_url; const status=prompt('Status (draft/active/expired)', r.status||'draft')||r.status; await api(`/api/licenses/${r.id}`,{ method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ channel, rights_granted, revenue_terms, start_date, end_date, agreement_url, status }) }); loadLicenses(id) }},'edit'), h('button',{class:'text-red-600', onclick: async ()=>{ await api(`/api/licenses/${r.id}`,{method:'DELETE'}); loadLicenses(id) }},'delete')); const row=h('div',{class:'flex items-center justify-between p-2 border-b text-sm'}, `${r.channel||'—'} · ${r.rights_granted||''} · ${r.start_date||''}${r.end_date?(' - '+r.end_date):''} · ${r.status||'draft'}`, actions); wrap.appendChild(row) }) }

async function renderReadiness(id){
  const box=document.getElementById('readiness'); if(!box) return;
  try{
    const [arts, caps, docs, avs] = await Promise.all([
      api(`/api/titles/${id}/artworks`),
      api(`/api/titles/${id}/captions`),
      api(`/api/titles/${id}/documents`),
      api(`/api/titles/${id}/avails`)
    ]);
    const havePoster = arts.some(a=>a.kind==='poster' && a.status!=='missing' && a.r2_key);
    const haveChain = docs.some(d=>d.doc_type==='chain_of_title' && d.status!=='missing' && d.r2_key);
    const haveEN = caps.some(c=>c.language==='en' && c.kind==='subtitles' && c.status!=='missing' && c.r2_key);
    const haveAvail = avs.length>0;
    const score = [havePoster, haveEN, haveChain, haveAvail].filter(Boolean).length;
    const badge = h('span',{class:`px-2 py-0.5 rounded text-xs ${score===4?'bg-green-100 text-green-700':'bg-amber-100 text-amber-800'}`}, score===4?'ready':'incomplete');
    const chip = (ok,label)=> h('span',{class:`inline-block px-2 py-0.5 rounded text-xs ${ok?'bg-green-100 text-green-700':'bg-gray-100 text-gray-700'}`}, label);
    box.innerHTML='';
    box.appendChild(h('div',{class:'p-3 bg-white border rounded flex items-center justify-between'},
      h('div',{}, h('div',{class:'text-sm text-gray-600'}, 'Readiness'), h('div',{class:'font-semibold flex items-center gap-2'}, `${score}/4 complete`, badge)),
      h('div',{class:'flex items-center gap-2'}, chip(havePoster,'Poster'), chip(haveEN,'EN Subtitles'), chip(haveChain,'Chain-of-Title'), chip(haveAvail,'Avail'))
    ));
  }catch(e){ box.textContent='Failed to compute readiness'; }
}

window.APP={ loadTitles, loadTitlesFiltered, createTitle, loadUsage, loadArtworks, loadCaptions, loadDocuments, uploadMultipart, loadProfile, saveProfile, loadAvails, createAvail, editAvail, wizardOpen, wizardClose, loadTasks, loadCast, addCast, loadCrew, addCrew, loadFestivals, addFestival, loadLicenses, renderReadiness }