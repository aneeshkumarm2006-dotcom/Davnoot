(()=>{var i=a=>String(a??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),C=(a,e=document)=>e.querySelector(a);function M(a){if(!a)return"\u2014";let e=new Date(a);return Number.isNaN(e.getTime())?"\u2014":e.toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"})}function g(a){if(!a)return"\u2014";let e=new Date(a),t=Math.round((Date.now()-e.getTime())/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let s=Math.round(t/60);if(s<24)return`${s}h ago`;let n=Math.round(s/24);return n<30?`${n}d ago`:M(a)}function u(a,{confirmLabel:e="Confirm",danger:t=!1}={}){return new Promise(s=>{let n=document.createElement("div");n.className="modal-backdrop",n.innerHTML=`
      <div class="modal modal-sm" role="dialog" aria-modal="true">
        <p class="modal-msg">${i(a)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${t?"btn-danger":"btn-dark"}" data-act="ok">${i(e)}</button>
        </div>
      </div>`;let o=c=>{n.remove(),document.removeEventListener("keydown",p),s(c)},p=c=>{c.key==="Escape"&&o(!1)};n.addEventListener("click",c=>{(c.target===n||c.target.dataset.act==="cancel")&&o(!1),c.target.dataset.act==="ok"&&o(!0)}),document.addEventListener("keydown",p),document.body.appendChild(n),n.querySelector('[data-act="ok"]').focus()})}function r(a,e="ok"){let t=document.createElement("div");t.className=`toast is-${e}`,t.textContent=a,document.body.appendChild(t),setTimeout(()=>t.classList.add("in"),10),setTimeout(()=>{t.classList.remove("in"),setTimeout(()=>t.remove(),300)},3200)}var y=class extends Error{constructor(e,t,s){super(t),this.status=e,this.fields=s||{}}};async function d(a,e,t,s){let n=await fetch(e,{method:a,headers:{...t?{"Content-Type":"application/json"}:{},...s||{}},body:t?JSON.stringify(t):void 0,credentials:"same-origin"});if(n.status===401){let p=encodeURIComponent(location.pathname+location.search);throw location.href=`/seoteam/login?next=${p}`,new y(401,"Signed out.")}let o=null;try{o=await n.json()}catch{}if(!n.ok)throw new y(n.status,o?.error||`Request failed (${n.status})`,o?.fields);return o}var l={overview:()=>d("GET","/api/admin/overview"),listPages:()=>d("GET","/api/admin/pages"),createPage:a=>d("POST","/api/admin/pages",a),getPage:a=>d("GET",`/api/admin/pages/${encodeURIComponent(a)}`),savePageDraft:(a,e,t)=>d("PUT",`/api/admin/pages/${encodeURIComponent(a)}`,e,t!=null?{"If-Match":String(t)}:null),publishPage:(a,e)=>d("POST",`/api/admin/pages/${encodeURIComponent(a)}/publish`,e||{}),deletePage:a=>d("DELETE",`/api/admin/pages/${encodeURIComponent(a)}`),pageRevisions:a=>d("GET",`/api/admin/pages/${encodeURIComponent(a)}/revisions`),restoreRevision:(a,e)=>d("POST",`/api/admin/pages/${encodeURIComponent(a)}/revisions`,{version:e}),seoTable:()=>d("GET","/api/admin/seo"),patchSeo:a=>d("PATCH","/api/admin/seo",a),listLeads:()=>d("GET","/api/admin/leads"),patchLead:a=>d("PATCH","/api/admin/leads",a),listRedirects:()=>d("GET","/api/admin/redirects"),createRedirect:a=>d("POST","/api/admin/redirects",a),deleteRedirect:a=>d("DELETE",`/api/admin/redirects?source=${encodeURIComponent(a)}`),getSettings:()=>d("GET","/api/admin/settings"),saveSettings:a=>d("PUT","/api/admin/settings",a),audit:()=>d("GET","/api/admin/audit"),logout:()=>d("POST","/api/seoteam/logout",{})};var w=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await l.overview()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the overview</h2><p class="muted">${i(t.message)}</p></div>`;return}this.render(e)}render(e){this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Overview</h1><p class="muted">Signed in as <strong>${i(e.role)}</strong>.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <div class="ov-grid">
        ${f(e.pages.total,"Pages",`${e.pages.marketing} marketing \xB7 ${e.pages.composed} custom`)}
        ${f(e.pages.unpublishedDrafts,"Unpublished drafts","pages with pending edits")}
        ${f(e.posts.published,"Blog posts",`${e.posts.draft} drafts`)}
        ${f(e.leads.unread,"New leads",e.leads.unread?"awaiting a reply":"inbox clear",e.leads.unread?"warn":"")}
        ${f(e.media.total,"Media","in the library")}
      </div>

      <h2 style="font-size:15px;margin:0 0 10px;">Recent activity</h2>
      ${e.activity.length?this.feed(e.activity):'<p class="muted">No activity yet.</p>'}
    `}feed(e){return`<div class="feed">${e.map(t=>`
      <div class="feed-row">
        <span class="when">${i(g(t.at))}</span>
        <span><strong>${i(t.action)}</strong> \u2014 ${i(t.target)} <span class="muted">${i(t.summary||"")}</span></span>
      </div>`).join("")}</div>`}};function f(a,e,t,s){return`<div class="ov-card">
    <div class="n"${s==="warn"&&a?' style="color:var(--warn)"':""}>${i(a)}</div>
    <div class="l">${i(e)}</div>
    <div class="muted small" style="margin-top:6px">${i(t)}</div>
  </div>`}var $=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await l.listPages()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load pages</h2><p class="muted">${i(t.message)}</p></div>`;return}this.render(e.pages),this.wire()}render(e){let t=e.filter(n=>n.base),s=e.filter(n=>!n.base);this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Pages</h1><p class="muted">Every URL on the site. The 8 marketing pages are content-editable; new pages get full layout control.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <h2 style="font-size:14px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 10px;">Marketing pages</h2>
      ${this.table(t,!1)}

      <h2 style="font-size:14px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:26px 0 10px;">Custom pages</h2>
      ${s.length?this.table(s,!0):'<p class="muted">No custom pages yet. <a href="/admin/new">Create one</a> from a template.</p>'}
    `}table(e,t){return`<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>Title</th><th>URL</th><th>Status</th><th>Edits</th><th>Editable</th><th>Updated</th>${t?"<th></th>":""}</tr></thead>
      <tbody>${e.map(s=>`
        <tr>
          <td><a href="/admin/pages/${encodeURIComponent(s.key)}"><strong>${i(s.title)}</strong></a></td>
          <td><a class="url" href="${i(s.url)}" target="_blank" rel="noopener">${i(s.url)}</a></td>
          <td><span class="pill pill-${q(s.status)}">${i(s.status)}</span></td>
          <td>${s.hasUnpublishedChanges?'<span class="dot-unpub" title="Unpublished changes">\u25CF draft</span>':'<span class="muted small">live</span>'}</td>
          <td>${s.editableSlots!=null?`<span class="cell-count">${s.editableSlots} fields</span>`:'<span class="pill pill-muted">layout</span>'}</td>
          <td class="muted small">${s.updatedAt?i(g(s.updatedAt)):"\u2014"}</td>
          ${t?`<td><button class="btn btn-ghost btn-sm" data-del="${i(s.key)}">Delete</button></td>`:""}
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.del;if(await u(`Delete the page "${t}"? This can't be undone.`,{confirmLabel:"Delete",danger:!0}))try{await l.deletePage(t),r("Page deleted."),this.load()}catch(s){r(s.message,"err")}})})}};function q(a){return a==="live"||a==="published"?"live":a==="archived"?"archived":"draft"}var L=class{constructor(e,{key:t}){this.root=e,this.key=t,this.dirty=!1,this.saving=!1,this.values={},this.autosave={hasUnsavedChanges:()=>this.dirty}}destroy(){clearTimeout(this._debounce)}async mount(){if(this.key==="new")return this.renderNew();this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.page=await l.getPage(this.key)}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the page</h2><p class="muted">${i(e.message)}</p></div>`;return}this.values=N(this.page.draft),this.render(),this.wire()}render(){let e=H(this.page.slots);this.root.innerHTML=`
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">\u2190 Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${i(this.page.draft.title||this.key)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="editor-status" id="status">${this.page.hasUnpublishedChanges?"Unpublished changes":"Live"}</span>
          <button class="btn btn-ghost" id="revisions">History</button>
          <button class="btn btn-dark" id="publish">Publish</button>
        </div>
      </div>

      <div class="editor-split">
        <div class="editor-fields">
          ${this.page.slots.length?Object.entries(e).map(([t,s])=>this.group(t,s)).join(""):'<p class="muted">This page has no editable fields yet. Add <code>data-cms</code> annotations to <code>pages/'+i(this.key)+"</code> to expose content here.</p>"}
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>
    `}group(e,t){return`<div class="field-group"><h3>${i(e)}</h3>
      ${t.map(s=>this.field(s)).join("")}
    </div>`}field(e){let t=this.values[e.key]!=null?this.values[e.key]:e.def,s="f_"+e.key.replace(/[^a-z0-9]/gi,"_");return e.kind==="inline"||e.kind==="richtext"?`<div class="field">
        <label>${i(e.label)}</label>
        <div class="inline-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="accent" title="Accent (em)"><em>A</em></button>
        </div>
        <div class="inline-edit" contenteditable="true" data-slot="${i(e.key)}" id="${s}">${t}</div>
      </div>`:`<div class="field">
      <label>${i(e.label)}</label>
      <input class="input" data-slot="${i(e.key)}" id="${s}" value="${i(A(t))}" />
    </div>`}wire(){this.root.querySelectorAll(".inline-toolbar button").forEach(e=>{e.addEventListener("mousedown",t=>{t.preventDefault();let s=e.dataset.cmd;s==="accent"?document.execCommand("italic"):document.execCommand(s)})}),this.root.querySelectorAll("[data-slot]").forEach(e=>{let t=()=>e.isContentEditable?e.innerHTML:e.value,s=()=>{this.values[e.dataset.slot]=t(),this.touch()};e.addEventListener("input",s),e.addEventListener("blur",s)}),this.root.querySelector("#publish")?.addEventListener("click",()=>this.publish()),this.root.querySelector("#revisions")?.addEventListener("click",()=>this.showRevisions())}touch(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.save(),900)}async save(){if(this.saving)return;this.saving=!0,this.setStatus("Saving\u2026","dirty");let e=I(this.values,this.page);e.__version=this.page.version;try{let t=await l.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(t){t.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),r("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),r(t.message,"err"))}finally{this.saving=!1}}async publish(){if(this.dirty&&await this.save(),!!await u("Publish this page? Your draft edits go live within ~60 seconds.",{confirmLabel:"Publish"}))try{await l.publishPage(this.key),r("Published \u2014 live in ~60s."),this.setStatus("Live","saved"),this.page.hasUnpublishedChanges=!1}catch(e){r(e.message,"err")}}async showRevisions(){let e;try{e=await l.pageRevisions(this.key)}catch(s){r(s.message,"err");return}if(!e.revisions.length){r("No revisions yet.");return}let t=e.revisions.map(s=>`v${s.version} \xB7 ${new Date(s.at).toLocaleString()} \xB7 ${s.by}`).join(`
`);if(await u(`Restore the most recent revision into the draft?

${t}`,{confirmLabel:"Restore latest"}))try{await l.restoreRevision(this.key,e.revisions[0].version),r("Restored into draft."),this.mount()}catch(s){r(s.message,"err")}}reloadPreview(){clearTimeout(this._pv),this._pv=setTimeout(()=>{let e=this.root.querySelector("#preview");e&&(e.src=e.src)},400)}setStatus(e,t){let s=this.root.querySelector("#status");s&&(s.textContent=e,s.className="editor-status "+(t||""))}renderNew(){this.root.innerHTML=`
      <header class="page-head"><div><h1>New page</h1><p class="muted">Create a custom page at a clean URL.</p></div></header>
      <div class="field-group" style="max-width:520px">
        <div class="field"><label>Title</label><input class="input" id="np-title" placeholder="Pricing" /></div>
        <div class="field"><label>URL slug</label><input class="input" id="np-slug" placeholder="pricing" /><p class="muted small">The page will live at <code>/<span id="np-preview">pricing</span></code></p></div>
        <div class="field"><label>Kind</label><select class="input" id="np-kind">
          <option value="landing">Landing page</option><option value="service">Service page</option>
          <option value="caseStudy">Case study</option><option value="legal">Legal</option></select></div>
        <button class="btn btn-dark" id="np-create">Create</button>
      </div>`;let e=this.root.querySelector("#np-slug");e.addEventListener("input",()=>{this.root.querySelector("#np-preview").textContent=e.value||"slug"}),this.root.querySelector("#np-create").addEventListener("click",async()=>{try{let t=await l.createPage({title:this.root.querySelector("#np-title").value,slug:e.value.trim(),kind:this.root.querySelector("#np-kind").value});r("Page created."),history.pushState({},"",`/admin/pages/${encodeURIComponent(t.key)}`),window.dispatchEvent(new PopStateEvent("popstate"))}catch(t){r(t.fields?.slug||t.message,"err")}})}};function H(a){var t;let e={};for(let s of a)(e[t=s.group]||(e[t]=[])).push(s);return e}function N(a){let e={};for(let[t,s]of Object.entries(a?.seo||{}))s!=null&&(e["seo."+t]=s);for(let t of a?.sections||[])for(let[s,n]of Object.entries(t.fields||{}))n!=null&&(e[s]=n);return e}function I(a,e){let t={},s={};for(let[o,p]of Object.entries(a))o.startsWith("seo.")?t[o.slice(4)]=p:s[o]=p;let n={title:e.draft?.title||"",sections:[{id:"overlay",source:"base",fields:s}]};return Object.keys(t).length&&(n.seo=t),n}function A(a){return String(a||"").replace(/<[^>]+>/g,"")}var D=[{id:"all",label:"All"},{id:"no-desc",label:"Missing description",test:a=>!a.metaDescription},{id:"title-len",label:"Title out of range",test:a=>a.titleLen<30||a.titleLen>60},{id:"noindex",label:"Noindexed",test:a=>a.robotsIndex===!1},{id:"dupe-title",label:"Duplicate title"},{id:"off-canon",label:"Off-site canonical",test:a=>a.canonicalUrl&&!a.canonicalUrl.includes("davnoot.com")}],S=class{constructor(e){this.root=e,this.filter="all"}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.data=await l.seoTable()}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the SEO table</h2><p class="muted">${i(e.message)}</p></div>`;return}this.markDuplicates(),this.render(),this.wire()}markDuplicates(){let e=new Map;for(let t of this.data.rows){let s=(t.metaTitle||t.title||"").trim().toLowerCase();s&&e.set(s,(e.get(s)||0)+1)}for(let t of this.data.rows){let s=(t.metaTitle||t.title||"").trim().toLowerCase();t._dupeTitle=s&&e.get(s)>1}}rows(){let e=D.find(t=>t.id===this.filter);return this.filter==="dupe-title"?this.data.rows.filter(t=>t._dupeTitle):e?.test?this.data.rows.filter(e.test):this.data.rows}render(){let e=this.rows();this.root.innerHTML=`
      <header class="page-head">
        <div><h1>SEO</h1><p class="muted">Every URL on the site. Edit inline \u2014 changes to a page land on its draft and go live when you publish it.</p></div>
      </header>
      <div class="table-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${D.map(t=>`<button class="btn btn-sm ${this.filter===t.id?"btn-dark":"btn-ghost"}" data-filter="${t.id}">${i(t.label)}</button>`).join("")}
      </div>
      <div class="table-scroll"><table class="grid-table">
        <thead><tr><th>URL</th><th>Meta title</th><th>Meta description</th><th>Robots</th><th>Canonical</th><th></th></tr></thead>
        <tbody>${e.map(t=>this.row(t)).join("")}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">${e.length} of ${this.data.rows.length} URLs.</p>
    `}row(e){let t=`${e.type}:${e.key}`;return`<tr data-ref="${i(t)}">
      <td>
        <a class="url" href="${i(e.url)}" target="_blank" rel="noopener">${i(e.url)}</a>
        <div class="small">${e.type==="post"?'<span class="pill pill-muted">post</span>':'<span class="pill pill-muted">page</span>'} ${e.seoReady?'<span class="pill pill-ok">SEO ready</span>':""} ${e._dupeTitle?'<span class="pill pill-warn">dupe title</span>':""}</div>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaTitle" value="${i(e.metaTitle)}" placeholder="${i(e.title)}" />
        <span class="cell-count ${e.titleLen<30||e.titleLen>60?"bad":""}" data-count="title">${e.titleLen}/60</span>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaDescription" value="${i(e.metaDescription)}" placeholder="\u2014" />
        <span class="cell-count ${e.descLen&&(e.descLen<120||e.descLen>160)?"bad":""}" data-count="desc">${e.descLen}/160</span>
      </td>
      <td>
        <select class="cell-edit" data-field="seo.robotsIndex">
          <option value="" ${e.robotsIndex===void 0?"selected":""}>Default (index)</option>
          <option value="true" ${e.robotsIndex===!0?"selected":""}>index</option>
          <option value="false" ${e.robotsIndex===!1?"selected":""}>noindex</option>
        </select>
      </td>
      <td><input class="cell-edit" data-field="seo.canonicalUrl" value="${i(e.canonicalUrl)}" placeholder="\u2014" style="min-width:150px" /></td>
      <td><a class="btn btn-ghost btn-sm" href="${i(e.editUrl)}"${e.type==="post"?' target="_blank" rel="noopener"':""}>Edit</a></td>
    </tr>`}wire(){this.root.querySelectorAll("[data-filter]").forEach(e=>e.addEventListener("click",()=>{this.filter=e.dataset.filter,this.render(),this.wire()})),this.root.querySelectorAll("tr[data-ref]").forEach(e=>{let[t,s]=e.dataset.ref.split(/:(.+)/);e.querySelectorAll("[data-field]").forEach(n=>{let o=async()=>{let p=n.dataset.field,c=n.value;p==="seo.robotsIndex"&&(c=c===""?null:c==="true");try{await l.patchSeo({type:t,key:s,field:p,value:c}),n.classList.add("saved-flash"),setTimeout(()=>n.classList.remove("saved-flash"),900);let v=this.data.rows.find(U=>`${U.type}:${U.key}`===e.dataset.ref);v&&p==="seo.metaTitle"&&(v.metaTitle=c||""),v&&p==="seo.metaDescription"&&(v.metaDescription=c||"")}catch(v){r(v.fields?.[n.dataset.field]||v.message,"err")}};n.tagName==="SELECT"?n.addEventListener("change",o):(n.addEventListener("blur",o),n.addEventListener("input",()=>this.updateCount(e,n)))})})}updateCount(e,t){if(t.dataset.field==="seo.metaTitle"){let s=e.querySelector('[data-count="title"]');s&&(s.textContent=`${t.value.length}/60`,s.classList.toggle("bad",t.value.length<30||t.value.length>60))}else if(t.dataset.field==="seo.metaDescription"){let s=e.querySelector('[data-count="desc"]');s&&(s.textContent=`${t.value.length}/160`,s.classList.toggle("bad",t.value.length&&(t.value.length<120||t.value.length>160)))}}};var j=["new","contacted","won","lost"],T=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await l.listLeads()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${i(t.message)}</p></div>`;return}this.render(e),this.wire()}render({leads:e,unread:t}){this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${t} new \xB7 ${e.length} total. Every booking is captured here even if the email fails.</p></div>
        <div class="page-actions"><button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      ${e.length?this.table(e):'<div class="empty"><h2>No leads yet</h2><p class="muted">Booking form submissions will appear here.</p></div>'}
    `,this._leads=e}table(e){return`<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>When</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Email</th><th>Status</th></tr></thead>
      <tbody>${e.map(t=>`
        <tr>
          <td class="muted small">${i(g(t.createdAt))}</td>
          <td><strong>${i(t.name)}</strong>${t.company?`<div class="muted small">${i(t.company)}</div>`:""}</td>
          <td><a class="url" href="mailto:${i(t.email)}">${i(t.email)}</a></td>
          <td>${i(t.service||"\u2014")}</td>
          <td class="small">${i(t.timeSlot||"\u2014")}</td>
          <td>${t.emailSent?'<span class="pill pill-ok">sent</span>':'<span class="pill pill-warn">failed</span>'}</td>
          <td><select class="input input-sm" data-status="${i(t._id)}">${j.map(s=>`<option value="${s}" ${t.status===s?"selected":""}>${s}</option>`).join("")}</select></td>
        </tr>${t.brief?`<tr><td></td><td colspan="6" class="muted small" style="padding-top:0">\u201C${i(t.brief)}\u201D</td></tr>`:""}`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelectorAll("[data-status]").forEach(e=>{e.addEventListener("change",async()=>{try{await l.patchLead({id:e.dataset.status,status:e.value}),r("Updated.")}catch(t){r(t.message,"err")}})}),this.root.querySelector("#csv")?.addEventListener("click",()=>this.exportCsv())}exportCsv(){let e=this._leads||[],t=["createdAt","name","email","company","role","service","timeSlot","status","emailSent","brief"],s=[t.join(",")].concat(e.map(p=>t.map(c=>`"${String(p[c]??"").replace(/"/g,'""')}"`).join(","))).join(`
`),n=new Blob([s],{type:"text/csv"}),o=document.createElement("a");o.href=URL.createObjectURL(n),o.download="davnoot-leads.csv",o.click(),URL.revokeObjectURL(o.href)}};var k=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await l.listRedirects()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load redirects</h2><p class="muted">${i(t.message)}</p></div>`;return}this.render(e.redirects),this.wire()}render(e){this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Redirects</h1><p class="muted">Applied without a deploy. Note: a redirect only fires for single-segment paths that reach the page renderer.</p></div>
      </header>

      <div class="field-group" style="margin-bottom:22px">
        <h3>Add a redirect</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0;flex:1;min-width:160px"><label>From (path)</label><input class="input" id="src" placeholder="/old-page" /></div>
          <div class="field" style="margin:0;flex:1;min-width:160px"><label>To (path or URL)</label><input class="input" id="dst" placeholder="/new-page" /></div>
          <div class="field" style="margin:0"><label>Type</label>
            <select class="input input-sm" id="code"><option value="308">308 permanent</option><option value="302">302 temporary</option><option value="410">410 gone</option></select></div>
          <button class="btn btn-dark" id="add">Add</button>
        </div>
      </div>

      ${e.length?this.table(e):'<p class="muted">No redirects yet.</p>'}
    `}table(e){return`<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>From</th><th>To</th><th>Type</th><th>Hits</th><th></th></tr></thead>
      <tbody>${e.map(t=>`
        <tr>
          <td class="url">${i(t.source)}</td>
          <td class="url">${t.status===410?'<span class="pill pill-muted">gone</span>':i(t.destination)}</td>
          <td><span class="pill pill-muted">${t.status}</span></td>
          <td class="cell-count">${t.hits||0}</td>
          <td><button class="btn btn-ghost btn-sm" data-del="${i(t.source)}">Delete</button></td>
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelector("#add")?.addEventListener("click",async()=>{let e=this.root.querySelector("#src").value.trim(),t=this.root.querySelector("#dst").value.trim(),s=Number(this.root.querySelector("#code").value);try{await l.createRedirect({source:e,destination:t,status:s}),r("Redirect added."),this.load()}catch(n){r(n.fields?.source||n.fields?.destination||n.message,"err")}}),this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{if(await u(`Delete the redirect from ${e.dataset.del}?`,{confirmLabel:"Delete",danger:!0}))try{await l.deleteRedirect(e.dataset.del),r("Deleted."),this.load()}catch(t){r(t.message,"err")}})})}};var x=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await l.getSettings()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load settings</h2><p class="muted">${i(t.message)}</p></div>`;return}this.eff=e.effective,this.render(e.effective),this.wire()}render(e){this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Site settings</h1><p class="muted">Brand, contact, and organization details used across the site.</p></div>
        <div class="page-actions"><button class="btn btn-dark" id="save">Save</button></div>
      </header>

      <div class="editor-fields" style="max-width:640px">
        <div class="field-group"><h3>Brand</h3>
          ${h("brand.name","Name",e.brand.name)}
          ${h("brand.wordmark","Wordmark",e.brand.wordmark)}
          ${h("brand.tagline","Tagline",e.brand.tagline)}
        </div>
        <div class="field-group"><h3>Contact</h3>
          ${h("contact.email","Email",e.contact.email)}
          ${h("contact.phone","Phone (E.164)",e.contact.phone)}
          ${h("contact.phoneDisplay","Phone (display)",e.contact.phoneDisplay)}
        </div>
        <div class="field-group"><h3>Organization</h3>
          ${h("org.description","Description",e.org.description,!0)}
          ${h("org.priceRange","Price range",e.org.priceRange)}
          ${h("defaults.siteUrl","Canonical site URL",e.defaults.siteUrl)}
          ${h("defaults.ogImage","Default OG image",e.defaults.ogImage)}
        </div>
      </div>
      <p class="muted small" style="margin-top:14px">Changes are stored as a diff over the built-in defaults. Empty fields fall back to the default.</p>
    `}wire(){this.root.querySelector("#save")?.addEventListener("click",async()=>{let e={};this.root.querySelectorAll("[data-key]").forEach(t=>{O(e,t.dataset.key,t.value)});try{await l.saveSettings(e),r("Settings saved.")}catch(t){r(t.message,"err")}})}};function h(a,e,t,s){let n=s?`<textarea class="input" rows="3" data-key="${a}">${i(t||"")}</textarea>`:`<input class="input" data-key="${a}" value="${i(t||"")}" />`;return`<div class="field"><label>${i(e)}</label>${n}</div>`}function O(a,e,t){let s=e.split("."),n=a;for(let o=0;o<s.length-1;o++)(!n[s[o]]||typeof n[s[o]]!="object")&&(n[s[o]]={}),n=n[s[o]];n[s[s.length-1]]=t}var E=class{constructor(e){this.root=e}async mount(){this.root.innerHTML=`
      <div class="empty">
        <h2>Page not found</h2>
        <p class="muted">Nothing lives at <code>${i(location.pathname)}</code>.</p>
        <p><a class="btn btn-dark" href="/admin">Back to overview</a></p>
      </div>`}};var m=C("#app"),b=null;function _(){let a=location.pathname.replace(/^\/admin\/?/,"").split("/").filter(Boolean);if(!a.length)return{view:"overview"};switch(a[0]){case"pages":return a[1]?{view:"page-editor",key:decodeURIComponent(a.slice(1).join("/"))}:{view:"pages"};case"new":return{view:"page-editor",key:"new"};case"seo":return{view:"seo"};case"leads":return{view:"leads"};case"redirects":return{view:"redirects"};case"settings":return{view:"settings"};default:return{view:"404"}}}var P={overview:()=>new w(m),pages:()=>new $(m),"page-editor":a=>new L(m,{key:a.key}),seo:()=>new S(m),leads:()=>new T(m),redirects:()=>new k(m),settings:()=>new x(m),404:()=>new E(m)};async function R(){b?.destroy?.();let a=_();b=(P[a.view]||P[404])(a),G(a.view);try{await b.mount()}catch(e){m.innerHTML=`<div class="empty"><h2>Something went wrong</h2><p>${B(e.message)}</p></div>`}}function G(a){for(let e of document.querySelectorAll(".admin-nav a[data-view]"))e.classList.toggle("active",e.dataset.view===a||a==="page-editor"&&e.dataset.view==="pages")}function B(a){let e=document.createElement("div");return e.textContent=String(a??""),e.innerHTML}document.addEventListener("click",async a=>{let e=a.target.closest("a");if(!e)return;let t=e.getAttribute("href");!t?.startsWith("/admin")||e.target==="_blank"||(a.preventDefault(),!(b?.autosave?.hasUnsavedChanges?.()&&!await u("You have unsaved changes. Leave anyway?",{confirmLabel:"Leave",danger:!0}))&&(history.pushState({},"",t),R()))});window.addEventListener("popstate",R);C("#logout")?.addEventListener("click",async()=>{b?.autosave?.hasUnsavedChanges?.()&&!await u("You have unsaved changes. Sign out anyway?",{confirmLabel:"Sign out",danger:!0})||(await l.logout(),location.href="/seoteam/login")});R();})();
