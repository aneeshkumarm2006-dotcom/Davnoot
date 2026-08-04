/*srchash:d59a3f6c0ce8640a67285679f934ba6012ac7540f6377fa06ba3b5326366559e*/
(()=>{var a=i=>String(i??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),P=(i,e=document)=>e.querySelector(i);function z(i){if(!i)return"\u2014";let e=new Date(i);return Number.isNaN(e.getTime())?"\u2014":e.toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"})}function H(i){if(!i)return"\u2014";let e=new Date(i);return Number.isNaN(e.getTime())?"\u2014":e.toLocaleDateString("en-US",{timeZone:"America/Toronto",month:"short",day:"numeric",year:"numeric"})}function I(i){if(!i)return"";let e=new Date(i);return Number.isNaN(e.getTime())?"":e.toLocaleTimeString("en-US",{timeZone:"America/Toronto",hour:"numeric",minute:"2-digit",hour12:!0})}function k(i){if(!i)return"\u2014";let e=new Date(i),t=Math.round((Date.now()-e.getTime())/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let s=Math.round(t/60);if(s<24)return`${s}h ago`;let n=Math.round(s/24);return n<30?`${n}d ago`:z(i)}function u(i,{confirmLabel:e="Confirm",danger:t=!1}={}){return new Promise(s=>{let n=document.createElement("div");n.className="modal-backdrop",n.innerHTML=`
      <div class="modal modal-sm" role="dialog" aria-modal="true">
        <p class="modal-msg">${a(i)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${t?"btn-danger":"btn-dark"}" data-act="ok">${a(e)}</button>
        </div>
      </div>`;let o=l=>{n.remove(),document.removeEventListener("keydown",r),s(l)},r=l=>{l.key==="Escape"&&o(!1)};n.addEventListener("click",l=>{(l.target===n||l.target.dataset.act==="cancel")&&o(!1),l.target.dataset.act==="ok"&&o(!0)}),document.addEventListener("keydown",r),document.body.appendChild(n),n.querySelector('[data-act="ok"]').focus()})}function d(i,e="ok"){let t=document.createElement("div");t.className=`toast is-${e}`,t.textContent=i,document.body.appendChild(t),setTimeout(()=>t.classList.add("in"),10),setTimeout(()=>{t.classList.remove("in"),setTimeout(()=>t.remove(),300)},3200)}var S=class extends Error{constructor(e,t,s){super(t),this.status=e,this.fields=s||{}}};async function p(i,e,t,s){let n=await fetch(e,{method:i,headers:{...t?{"Content-Type":"application/json"}:{},...s||{}},body:t?JSON.stringify(t):void 0,credentials:"same-origin"});if(n.status===401){let r=encodeURIComponent(location.pathname+location.search);throw location.href=`/seoteam/login?next=${r}`,new S(401,"Signed out.")}let o=null;try{o=await n.json()}catch{}if(!n.ok)throw new S(n.status,o?.error||`Request failed (${n.status})`,o?.fields);return o}var c={overview:()=>p("GET","/api/admin/overview"),listPages:()=>p("GET","/api/admin/pages"),createPage:i=>p("POST","/api/admin/pages",i),getPage:i=>p("GET",`/api/admin/pages/${encodeURIComponent(i)}`),savePageDraft:(i,e,t)=>p("PUT",`/api/admin/pages/${encodeURIComponent(i)}`,e,t!=null?{"If-Match":String(t)}:null),publishPage:(i,e)=>p("POST",`/api/admin/pages/${encodeURIComponent(i)}/publish`,e||{}),deletePage:i=>p("DELETE",`/api/admin/pages/${encodeURIComponent(i)}`),pageRevisions:i=>p("GET",`/api/admin/pages/${encodeURIComponent(i)}/revisions`),restoreRevision:(i,e)=>p("POST",`/api/admin/pages/${encodeURIComponent(i)}/revisions`,{version:e}),seoTable:()=>p("GET","/api/admin/seo"),patchSeo:i=>p("PATCH","/api/admin/seo",i),listLeads:()=>p("GET","/api/admin/leads"),patchLead:i=>p("PATCH","/api/admin/leads",i),listRedirects:()=>p("GET","/api/admin/redirects"),createRedirect:i=>p("POST","/api/admin/redirects",i),deleteRedirect:i=>p("DELETE",`/api/admin/redirects?source=${encodeURIComponent(i)}`),getSettings:()=>p("GET","/api/admin/settings"),saveSettings:i=>p("PUT","/api/admin/settings",i),audit:()=>p("GET","/api/admin/audit"),logout:()=>p("POST","/api/seoteam/logout",{})};var L=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await c.overview()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the overview</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e)}render(e){this.root.innerHTML=`
      ${e.previewEnv?'<div class="preview-banner" role="alert">\u26A0 PREVIEW deployment \u2014 you are editing the <strong>preview</strong> database. Publishing here does <strong>not</strong> change the live site.</div>':""}
      <header class="page-head">
        <div><h1>Overview</h1><p class="muted">Signed in as <strong>${a(e.role)}</strong>.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <div class="ov-grid">
        ${y(e.pages.total,"Pages",`${e.pages.marketing} marketing \xB7 ${e.pages.composed} custom`)}
        ${y(e.pages.unpublishedDrafts,"Unpublished drafts","pages with pending edits")}
        ${y(e.posts.published,"Blog posts",`${e.posts.draft} drafts`)}
        ${y(e.leads.unread,"New leads",e.leads.unread?"awaiting a reply":"inbox clear",e.leads.unread?"warn":"")}
        ${y(e.media.total,"Media","in the library")}
      </div>

      <h2 style="font-size:15px;margin:0 0 10px;">Recent activity</h2>
      ${e.activity.length?this.feed(e.activity):'<p class="muted">No activity yet.</p>'}
    `}feed(e){return`<div class="feed">${e.map(t=>`
      <div class="feed-row">
        <span class="when">${a(k(t.at))}</span>
        <span><strong>${a(t.action)}</strong> \u2014 ${a(t.target)} <span class="muted">${a(t.summary||"")}</span></span>
      </div>`).join("")}</div>`}};function y(i,e,t,s){return`<div class="ov-card">
    <div class="n"${s==="warn"&&i?' style="color:var(--warn)"':""}>${a(i)}</div>
    <div class="l">${a(e)}</div>
    <div class="muted small" style="margin-top:6px">${a(t)}</div>
  </div>`}var E=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await c.listPages()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load pages</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e.pages),this.wire()}render(e){let t=e.filter(n=>n.base),s=e.filter(n=>!n.base);this.root.innerHTML=`
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
          <td><a href="/admin/pages/${encodeURIComponent(s.key)}"><strong>${a(s.title)}</strong></a></td>
          <td><a class="url" href="${a(s.url)}" target="_blank" rel="noopener">${a(s.url)}</a></td>
          <td><span class="pill pill-${W(s.status)}">${a(s.status)}</span></td>
          <td>${s.hasUnpublishedChanges?'<span class="dot-unpub" title="Unpublished changes">\u25CF draft</span>':'<span class="muted small">live</span>'}</td>
          <td>${s.editableSlots!=null?`<span class="cell-count">${s.editableSlots} fields</span>`:'<span class="pill pill-muted">layout</span>'}</td>
          <td class="muted small">${s.updatedAt?a(k(s.updatedAt)):"\u2014"}</td>
          ${t?`<td><button class="btn btn-ghost btn-sm" data-del="${a(s.key)}">Delete</button></td>`:""}
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.del;if(await u(`Delete the page "${t}"? This can't be undone.`,{confirmLabel:"Delete",danger:!0}))try{await c.deletePage(t),d("Page deleted."),this.load()}catch(s){d(s.message,"err")}})})}};function W(i){return i==="live"||i==="published"?"live":i==="archived"?"archived":"draft"}var $={hero:{label:"Hero",fields:[{key:"badge",kind:"inline",label:"Badge"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}],item:null},capabilities:{label:"Capabilities",fields:g(),item:{label:"Card",fields:[{key:"num",kind:"text",label:"Number"},{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"}]}},deliverables:{label:"What's included",fields:[...g(),{key:"intro1",kind:"inline",label:"Intro paragraph 1"},{key:"intro2",kind:"inline",label:"Intro paragraph 2"}],item:{label:"Deliverable",fields:[{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"},{key:"freq",kind:"text",label:"Cadence"}]}},approach:{label:"Approach",fields:g(),item:{label:"Step",fields:[{key:"num",kind:"text",label:"Number"},{key:"label",kind:"inline",label:"Label"},{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"}]}},tiers:{label:"Pricing",fields:g(),item:{label:"Tier",fields:[{key:"featured",kind:"bool",label:"Highlighted"},{key:"name",kind:"inline",label:"Name"},{key:"tagline",kind:"inline",label:"Tagline"},{key:"for",kind:"inline",label:"For"},{key:"timeline",kind:"inline",label:"Timeline"},{key:"includes",kind:"inline-list",label:"Includes (one per line)"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}]}},testimonials:{label:"Testimonials",fields:g(),item:{label:"Quote",fields:[{key:"quote",kind:"inline",label:"Quote"},{key:"avatar",kind:"text",label:"Avatar initials"},{key:"name",kind:"inline",label:"Name"},{key:"role",kind:"inline",label:"Role"}]}},faq:{label:"FAQ",fields:g(),item:{label:"Question",fields:[{key:"q",kind:"inline",label:"Question"},{key:"a",kind:"inline",label:"Answer"}]}},finalCta:{label:"Final CTA",fields:[{key:"eyebrow",kind:"inline",label:"Eyebrow"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}],item:null}};function g(){return[{key:"eyebrow",kind:"inline",label:"Eyebrow"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"}]}var Q=Object.keys($),T=class{constructor(e,{key:t}){this.root=e,this.key=t,this.dirty=!1,this.saving=!1,this.values={},this.autosave={hasUnsavedChanges:()=>this.dirty}}destroy(){clearTimeout(this._debounce)}async mount(){if(this.key==="new")return this.renderNew();this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.page=await c.getPage(this.key)}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the page</h2><p class="muted">${a(e.message)}</p></div>`;return}if(this.page.base===null){this.composed=!0,this.sections=Array.isArray(this.page.draft?.sections)?this.page.draft.sections.map(X):[],this.renderComposed();return}this.values=V(this.page.draft),this.render(),this.wire()}render(){let e=Y(this.page.slots);this.root.innerHTML=`
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">\u2190 Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${a(this.page.draft.title||this.key)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="editor-status" id="status">${this.page.hasUnpublishedChanges?"Unpublished changes":"Live"}</span>
          <button class="btn btn-ghost" id="revisions">History</button>
          <button class="btn btn-dark" id="publish">Publish</button>
        </div>
      </div>

      <div class="editor-split">
        <div class="editor-fields">
          ${this.page.slots.length?Object.entries(e).map(([t,s])=>this.group(t,s)).join(""):'<p class="muted">This page has no editable fields yet. Add <code>data-cms</code> annotations to <code>pages/'+a(this.key)+"</code> to expose content here.</p>"}
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>
    `}group(e,t){return`<div class="field-group"><h3>${a(e)}</h3>
      ${t.map(s=>this.field(s)).join("")}
    </div>`}field(e){let t=this.values[e.key]!=null?this.values[e.key]:e.def,s="f_"+e.key.replace(/[^a-z0-9]/gi,"_");return e.kind==="inline"||e.kind==="richtext"?`<div class="field">
        <label>${a(e.label)}</label>
        <div class="inline-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="accent" title="Accent (em)"><em>A</em></button>
        </div>
        <div class="inline-edit" contenteditable="true" data-slot="${a(e.key)}" id="${s}">${t}</div>
      </div>`:`<div class="field">
      <label>${a(e.label)}</label>
      <input class="input" data-slot="${a(e.key)}" id="${s}" value="${a(Z(t))}" />
    </div>`}wire(){this.root.querySelectorAll(".inline-toolbar button").forEach(e=>{e.addEventListener("mousedown",t=>{t.preventDefault();let s=e.dataset.cmd;s==="accent"?document.execCommand("italic"):document.execCommand(s)})}),this.root.querySelectorAll("[data-slot]").forEach(e=>{let t=()=>e.isContentEditable?e.innerHTML:e.value,s=()=>{this.values[e.dataset.slot]=t(),this.touch()};e.addEventListener("input",s),e.addEventListener("blur",s)}),this.root.querySelector("#publish")?.addEventListener("click",()=>this.publish()),this.root.querySelector("#revisions")?.addEventListener("click",()=>this.showRevisions())}touch(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.save(),900)}async save(){if(this.saving)return;this.saving=!0,this.setStatus("Saving\u2026","dirty");let e=K(this.values,this.page);e.__version=this.page.version;try{let t=await c.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(t){t.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),d("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),d(t.message,"err"))}finally{this.saving=!1}}async publish(){if(this.dirty&&await this.save(),!!await u("Publish this page? Your draft edits go live within ~60 seconds.",{confirmLabel:"Publish"}))try{await c.publishPage(this.key),d("Published \u2014 live in ~60s."),this.setStatus("Live","saved"),this.page.hasUnpublishedChanges=!1}catch(e){d(e.message,"err")}}async showRevisions(){let e;try{e=await c.pageRevisions(this.key)}catch(s){d(s.message,"err");return}if(!e.revisions.length){d("No revisions yet.");return}let t=e.revisions.map(s=>`v${s.version} \xB7 ${new Date(s.at).toLocaleString()} \xB7 ${s.by}`).join(`
`);if(await u(`Restore the most recent revision into the draft?

${t}`,{confirmLabel:"Restore latest"}))try{await c.restoreRevision(this.key,e.revisions[0].version),d("Restored into draft."),this.mount()}catch(s){d(s.message,"err")}}reloadPreview(){clearTimeout(this._pv),this._pv=setTimeout(()=>{let e=this.root.querySelector("#preview");e&&(e.src=e.src)},400)}setStatus(e,t){let s=this.root.querySelector("#status");s&&(s.textContent=e,s.className="editor-status "+(t||""))}renderComposed(){this.root.innerHTML=`
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">\u2190 Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${a(this.page.draft?.title||this.key)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="editor-status" id="status">${this.page.hasUnpublishedChanges?"Unpublished changes":"Draft"}</span>
          <button class="btn btn-ghost" id="revisions">History</button>
          <button class="btn btn-dark" id="publish">Publish</button>
        </div>
      </div>
      <div class="editor-split">
        <div class="editor-fields">
          <div class="section-palette">
            <span class="muted small">Add a section:</span>
            ${Q.map(e=>`<button class="btn btn-ghost btn-add-section" data-type="${e}">+ ${a($[e].label)}</button>`).join("")}
          </div>
          <div id="section-list">${this.sections.map((e,t)=>this.sectionCard(e,t)).join("")||'<p class="muted">No sections yet. Add one above to start building the page.</p>'}</div>
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>`,this.wireComposed()}sectionCard(e,t){let s=$[e.type];if(!s)return"";let n=s.fields.map(r=>this.fieldControl(`s${t}.${r.key}`,r,e.fields?.[r.key])).join(""),o=s.item?`<div class="section-items"><div class="muted small" style="margin:8px 0 4px">${a(s.item.label)}s</div>
          ${(e.items||[]).map((r,l)=>`<div class="section-item">
            <div class="section-item-head"><span class="muted small">${a(s.item.label)} ${l+1}</span><button class="btn-icon btn-del-item" data-s="${t}" data-i="${l}" title="Remove">\u2715</button></div>
            ${s.item.fields.map(h=>this.fieldControl(`s${t}.i${l}.${h.key}`,h,r?.[h.key])).join("")}
          </div>`).join("")}
          <button class="btn btn-ghost btn-add-item" data-s="${t}">+ Add ${a(s.item.label.toLowerCase())}</button></div>`:"";return`<div class="section-card${e.hidden?" is-hidden":""}" data-idx="${t}">
      <div class="section-card-head">
        <strong>${a(s.label)}</strong>
        <div class="section-card-actions">
          <button class="btn-icon btn-move" data-dir="-1" data-s="${t}" title="Move up">\u2191</button>
          <button class="btn-icon btn-move" data-dir="1" data-s="${t}" title="Move down">\u2193</button>
          <button class="btn-icon btn-hide" data-s="${t}" title="${e.hidden?"Show":"Hide"}">${e.hidden?"\u25CC":"\u25CF"}</button>
          <button class="btn-icon btn-del-section" data-s="${t}" title="Remove">\u2715</button>
        </div>
      </div>
      <div class="section-card-body">${n}${o}</div>
    </div>`}fieldControl(e,t,s){let n="f_"+e.replace(/[^a-z0-9]/gi,"_");if(t.kind==="bool")return`<label class="field-inline"><input type="checkbox" data-path="${e}" ${s?"checked":""} /> ${a(t.label)}</label>`;if(t.kind==="inline-list"){let o=Array.isArray(s)?s.join(`
`):"";return`<div class="field"><label>${a(t.label)}</label><textarea class="input" data-path="${e}" data-list="1" rows="3">${a(o)}</textarea></div>`}return t.kind==="richtext"?`<div class="field"><label>${a(t.label)}</label><textarea class="input" data-path="${e}" rows="3">${a(s||"")}</textarea></div>`:`<div class="field"><label>${a(t.label)}</label><input class="input" data-path="${e}" id="${n}" value="${a(s??"")}" /></div>`}wireComposed(){let e=t=>this.root.querySelector(t);this.root.querySelectorAll(".btn-add-section").forEach(t=>t.addEventListener("click",()=>{this.sections.push(J(t.dataset.type)),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-move").forEach(t=>t.addEventListener("click",()=>{let s=+t.dataset.s,n=+t.dataset.dir,o=s+n;o<0||o>=this.sections.length||([this.sections[s],this.sections[o]]=[this.sections[o],this.sections[s]],this.rerenderSections(),this.touchComposed())})),this.root.querySelectorAll(".btn-hide").forEach(t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];s.hidden=!s.hidden,this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-del-section").forEach(t=>t.addEventListener("click",async()=>{await u("Remove this section?",{confirmLabel:"Remove",danger:!0})&&(this.sections.splice(+t.dataset.s,1),this.rerenderSections(),this.touchComposed())})),this.root.querySelectorAll(".btn-add-item").forEach(t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];(s.items||(s.items=[])).push({}),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-del-item").forEach(t=>t.addEventListener("click",()=>{this.sections[+t.dataset.s].items.splice(+t.dataset.i,1),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll("[data-path]").forEach(t=>{let s=()=>{this.applyField(t),this.touchComposed()};t.addEventListener("input",s),t.addEventListener("change",s)}),e("#publish")?.addEventListener("click",()=>this.publish()),e("#revisions")?.addEventListener("click",()=>this.showRevisions())}rerenderSections(){let e=this.root.querySelector("#section-list");e&&(e.innerHTML=this.sections.map((t,s)=>this.sectionCard(t,s)).join("")||'<p class="muted">No sections yet. Add one above to start building the page.</p>',this.wireComposedList())}wireComposedList(){let e=(t,s)=>this.root.querySelectorAll("#section-list "+t).forEach(s);e(".btn-move",t=>t.addEventListener("click",()=>{let s=+t.dataset.s,n=s+ +t.dataset.dir;n<0||n>=this.sections.length||([this.sections[s],this.sections[n]]=[this.sections[n],this.sections[s]],this.rerenderSections(),this.touchComposed())})),e(".btn-hide",t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];s.hidden=!s.hidden,this.rerenderSections(),this.touchComposed()})),e(".btn-del-section",t=>t.addEventListener("click",async()=>{await u("Remove this section?",{confirmLabel:"Remove",danger:!0})&&(this.sections.splice(+t.dataset.s,1),this.rerenderSections(),this.touchComposed())})),e(".btn-add-item",t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];(s.items||(s.items=[])).push({}),this.rerenderSections(),this.touchComposed()})),e(".btn-del-item",t=>t.addEventListener("click",()=>{this.sections[+t.dataset.s].items.splice(+t.dataset.i,1),this.rerenderSections(),this.touchComposed()})),e("[data-path]",t=>{let s=()=>{this.applyField(t),this.touchComposed()};t.addEventListener("input",s),t.addEventListener("change",s)})}applyField(e){var b,N;let s=e.dataset.path.match(/^s(\d+)(?:\.i(\d+))?\.(.+)$/);if(!s)return;let[,n,o,r]=s,l=this.sections[+n];if(!l)return;let h;e.type==="checkbox"?h=e.checked:e.dataset.list?h=e.value.split(`
`).map(G=>G.trim()).filter(Boolean):h=e.value,o!=null?((b=l.items||(l.items=[]))[N=+o]||(b[N]={}),l.items[+o][r]=h):(l.fields||(l.fields={}))[r]=h}touchComposed(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.saveComposed(),900)}async saveComposed(){if(!this.saving){this.saving=!0,this.setStatus("Saving\u2026","dirty");try{let e={title:this.page.draft?.title||this.key,sections:this.sections},t=await c.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(e){e.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),d("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),d(e.message,"err"))}finally{this.saving=!1}}}renderNew(){this.root.innerHTML=`
      <header class="page-head"><div><h1>New page</h1><p class="muted">Create a custom page at a clean URL.</p></div></header>
      <div class="field-group" style="max-width:520px">
        <div class="field"><label>Title</label><input class="input" id="np-title" placeholder="Pricing" /></div>
        <div class="field"><label>URL slug</label><input class="input" id="np-slug" placeholder="pricing" /><p class="muted small">The page will live at <code>/<span id="np-preview">pricing</span></code></p></div>
        <div class="field"><label>Kind</label><select class="input" id="np-kind">
          <option value="landing">Landing page</option><option value="service">Service page</option>
          <option value="caseStudy">Case study</option><option value="legal">Legal</option></select></div>
        <button class="btn btn-dark" id="np-create">Create</button>
      </div>`;let e=this.root.querySelector("#np-slug");e.addEventListener("input",()=>{this.root.querySelector("#np-preview").textContent=e.value||"slug"}),this.root.querySelector("#np-create").addEventListener("click",async()=>{try{let t=await c.createPage({title:this.root.querySelector("#np-title").value,slug:e.value.trim(),kind:this.root.querySelector("#np-kind").value});d("Page created."),history.pushState({},"",`/admin/pages/${encodeURIComponent(t.key)}`),window.dispatchEvent(new PopStateEvent("popstate"))}catch(t){d(t.fields?.slug||t.message,"err")}})}};function Y(i){var t;let e={};for(let s of i)(e[t=s.group]||(e[t]=[])).push(s);return e}function V(i){let e={};for(let[t,s]of Object.entries(i?.seo||{}))s!=null&&(e["seo."+t]=s);for(let t of i?.sections||[])for(let[s,n]of Object.entries(t.fields||{}))n!=null&&(e[s]=n);return e}function K(i,e){let t={},s={};for(let[o,r]of Object.entries(i))o.startsWith("seo.")?t[o.slice(4)]=r:s[o]=r;let n={title:e.draft?.title||"",sections:[{id:"overlay",source:"base",fields:s}]};return Object.keys(t).length&&(n.seo=t),n}function Z(i){return String(i||"").replace(/<[^>]+>/g,"")}function J(i){let e=$[i],t={id:i+"-"+Math.random().toString(36).slice(2,8),type:i,source:"library",fields:{}};return e?.item&&(t.items=[{}]),t}function X(i){return{id:i.id,type:i.type,source:i.source||"library",hidden:!!i.hidden,fields:i.fields||{},items:Array.isArray(i.items)?i.items:void 0}}var j=[{id:"all",label:"All"},{id:"no-desc",label:"Missing description",test:i=>!i.metaDescription},{id:"title-len",label:"Title out of range",test:i=>i.titleLen<30||i.titleLen>60},{id:"noindex",label:"Noindexed",test:i=>i.robotsIndex===!1},{id:"dupe-title",label:"Duplicate title"},{id:"off-canon",label:"Off-site canonical",test:i=>i.canonicalUrl&&!i.canonicalUrl.includes("davnoot.com")}],x=class{constructor(e){this.root=e,this.filter="all"}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.data=await c.seoTable()}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the SEO table</h2><p class="muted">${a(e.message)}</p></div>`;return}this.markDuplicates(),this.render(),this.wire()}markDuplicates(){let e=new Map;for(let t of this.data.rows){let s=(t.metaTitle||t.title||"").trim().toLowerCase();s&&e.set(s,(e.get(s)||0)+1)}for(let t of this.data.rows){let s=(t.metaTitle||t.title||"").trim().toLowerCase();t._dupeTitle=s&&e.get(s)>1}}rows(){let e=j.find(t=>t.id===this.filter);return this.filter==="dupe-title"?this.data.rows.filter(t=>t._dupeTitle):e?.test?this.data.rows.filter(e.test):this.data.rows}render(){let e=this.rows();this.root.innerHTML=`
      <header class="page-head">
        <div><h1>SEO</h1><p class="muted">Every URL on the site. Edit inline \u2014 changes to a page land on its draft and go live when you publish it.</p></div>
      </header>
      <div class="table-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${j.map(t=>`<button class="btn btn-sm ${this.filter===t.id?"btn-dark":"btn-ghost"}" data-filter="${t.id}">${a(t.label)}</button>`).join("")}
      </div>
      <div class="table-scroll"><table class="grid-table">
        <thead><tr><th>URL</th><th>Meta title</th><th>Meta description</th><th>Robots</th><th>Canonical</th><th></th></tr></thead>
        <tbody>${e.map(t=>this.row(t)).join("")}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">${e.length} of ${this.data.rows.length} URLs.</p>
    `}row(e){let t=`${e.type}:${e.key}`;return`<tr data-ref="${a(t)}">
      <td>
        <a class="url" href="${a(e.url)}" target="_blank" rel="noopener">${a(e.url)}</a>
        <div class="small">${e.type==="post"?'<span class="pill pill-muted">post</span>':'<span class="pill pill-muted">page</span>'} ${e.seoReady?'<span class="pill pill-ok">SEO ready</span>':""} ${e._dupeTitle?'<span class="pill pill-warn">dupe title</span>':""}</div>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaTitle" value="${a(e.metaTitle)}" placeholder="${a(e.title)}" />
        <span class="cell-count ${e.titleLen<30||e.titleLen>60?"bad":""}" data-count="title">${e.titleLen}/60</span>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaDescription" value="${a(e.metaDescription)}" placeholder="\u2014" />
        <span class="cell-count ${e.descLen&&(e.descLen<120||e.descLen>160)?"bad":""}" data-count="desc">${e.descLen}/160</span>
      </td>
      <td>
        <select class="cell-edit" data-field="seo.robotsIndex">
          <option value="" ${e.robotsIndex===void 0?"selected":""}>Default (index)</option>
          <option value="true" ${e.robotsIndex===!0?"selected":""}>index</option>
          <option value="false" ${e.robotsIndex===!1?"selected":""}>noindex</option>
        </select>
      </td>
      <td><input class="cell-edit" data-field="seo.canonicalUrl" value="${a(e.canonicalUrl)}" placeholder="\u2014" style="min-width:150px" /></td>
      <td><a class="btn btn-ghost btn-sm" href="${a(e.editUrl)}"${e.type==="post"?' target="_blank" rel="noopener"':""}>Edit</a></td>
    </tr>`}wire(){this.root.querySelectorAll("[data-filter]").forEach(e=>e.addEventListener("click",()=>{this.filter=e.dataset.filter,this.render(),this.wire()})),this.root.querySelectorAll("tr[data-ref]").forEach(e=>{let[t,s]=e.dataset.ref.split(/:(.+)/);e.querySelectorAll("[data-field]").forEach(n=>{let o=async()=>{let r=n.dataset.field,l=n.value;r==="seo.robotsIndex"&&(l=l===""?null:l==="true");try{await c.patchSeo({type:t,key:s,field:r,value:l}),n.classList.add("saved-flash"),setTimeout(()=>n.classList.remove("saved-flash"),900);let h=this.data.rows.find(b=>`${b.type}:${b.key}`===e.dataset.ref);h&&r==="seo.metaTitle"&&(h.metaTitle=l||""),h&&r==="seo.metaDescription"&&(h.metaDescription=l||"")}catch(h){d(h.fields?.[n.dataset.field]||h.message,"err")}};n.tagName==="SELECT"?n.addEventListener("change",o):(n.addEventListener("blur",o),n.addEventListener("input",()=>this.updateCount(e,n)))})})}updateCount(e,t){if(t.dataset.field==="seo.metaTitle"){let s=e.querySelector('[data-count="title"]');s&&(s.textContent=`${t.value.length}/60`,s.classList.toggle("bad",t.value.length<30||t.value.length>60))}else if(t.dataset.field==="seo.metaDescription"){let s=e.querySelector('[data-count="desc"]');s&&(s.textContent=`${t.value.length}/160`,s.classList.toggle("bad",t.value.length&&(t.value.length<120||t.value.length>160)))}}};function O({value:i,options:e,id:t="",cls:s="",ariaLabel:n=""}){let o=e.find(r=>r.value===i)||e[0]||{label:""};return`<div class="cdrop${s?" "+s:""}" data-cdrop${t?` data-id="${a(t)}"`:""} data-value="${a(i??"")}">
    <button type="button" class="cdrop-btn" aria-haspopup="listbox" aria-expanded="false"${n?` aria-label="${a(n)}"`:""}>
      <span class="cdrop-label">${a(o.label)}</span>
      <svg class="cdrop-caret" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <ul class="cdrop-menu" role="listbox" hidden>
      ${e.map(r=>`<li role="option" class="cdrop-opt${r.value===i?" is-selected":""}" data-val="${a(r.value)}">${a(r.label)}</li>`).join("")}
    </ul>
  </div>`}function q(i,e){i.classList.toggle("is-open",e);let t=i.querySelector(".cdrop-btn"),s=i.querySelector(".cdrop-menu");t&&t.setAttribute("aria-expanded",e?"true":"false"),s&&(s.hidden=!e)}function U(){document.querySelectorAll(".cdrop.is-open").forEach(i=>q(i,!1))}var _=!1;function ee(){_||(_=!0,document.addEventListener("click",i=>{i.target.closest(".cdrop")||U()}),document.addEventListener("keydown",i=>{i.key==="Escape"&&U()}))}function B(i,e){ee(),i.addEventListener("click",t=>{let s=t.target.closest(".cdrop-btn");if(s&&i.contains(s)){let o=s.closest(".cdrop"),r=!o.classList.contains("is-open");U(),q(o,r);return}let n=t.target.closest(".cdrop-opt");if(n&&i.contains(n)){let o=n.closest(".cdrop"),r=n.dataset.val;q(o,!1),r!==o.dataset.value&&(o.dataset.value=r,o.querySelector(".cdrop-label").textContent=n.textContent,o.querySelectorAll(".cdrop-opt").forEach(l=>l.classList.toggle("is-selected",l===n)),e?.(o.dataset.id||"",r,o))}})}var te=["new","contacted","won","lost"],se=i=>i&&i[0].toUpperCase()+i.slice(1),ie={seo:"SEO",meta:"Meta Ads",email:"Email Marketing","ai-seo":"AI SEO","chatgpt-ads":"ChatGPT / AI Ads",software:"Custom Software",multi:"Multi-channel"},ae=/unsubscribe|wa\.me|t\.me\/|whats\s?app|telegram|jackpot|casino|crypto|bitcoin|https?:\/\/|www\.|\b\d{1,3}%\s*off\b|done-for-you|backlinks?\b/i;function f(i){return i.promo===!0?!0:i.promo===!1?!1:ae.test(`${i.brief||""} ${i.name||""} ${i.email||""}`)}var C=class{constructor(e){this.root=e,this.showPromos=!1}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await c.listLeads()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${a(t.message)}</p></div>`;return}this._all=e.leads||[],this.render(),this.wire()}render(){let e=this._all.filter(f),t=this._all.filter(r=>!f(r)),s=this.showPromos?this._all:t,n=t.filter(r=>r.status==="new").length,o=e.length?`<button class="btn btn-ghost" id="toggle-promos">${this.showPromos?"Hide":"Show"} ${e.length} promotion${e.length===1?"":"s"}</button>`:"";this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${n} new \xB7 ${t.length} real ${t.length===1?"lead":"leads"}${e.length?` \xB7 ${e.length} promotion${e.length===1?"":"s"} hidden`:""}. Captured even when the email fails.</p></div>
        <div class="page-actions">${o}<button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      ${s.length?this.table(s):'<div class="empty"><h2>No leads yet</h2><p class="muted">Booking form submissions will appear here.</p></div>'}
    `}table(e){return`<div class="table-scroll"><table class="grid-table leads-table">
      <thead><tr><th>When (ET)</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Email</th><th>Status</th></tr></thead>
      ${e.map(t=>`<tbody class="lead-group${f(t)?" is-promo":""}">
        <tr>
          <td class="muted small nowrap">${a(H(t.createdAt))}<div class="lead-time">${a(I(t.createdAt))}</div></td>
          <td><strong>${a(t.name)}</strong>${t.company?`<div class="muted small">${a(t.company)}</div>`:""}${f(t)?'<span class="pill pill-mute">promo</span>':""}</td>
          <td><a class="url" href="mailto:${a(t.email)}">${a(t.email)}</a></td>
          <td>${a(ie[t.service]||t.service||"\u2014")}</td>
          <td class="small nowrap">${a(t.timeSlot||"\u2014")}</td>
          <td>${t.emailSent?'<span class="pill pill-ok">sent</span>':'<span class="pill pill-warn">failed</span>'}</td>
          <td>
            ${O({id:t._id,value:t.status||"new",cls:"cdrop-sm",ariaLabel:"Lead status",options:te.map(s=>({value:s,label:se(s)}))})}
            <button type="button" class="lead-promo-btn" data-promo="${a(t._id)}" data-to="${f(t)?"false":"true"}">${f(t)?"Not a promotion":"Mark as promotion"}</button>
          </td>
        </tr>${t.brief?`<tr class="lead-msg-row"><td colspan="7"><p class="lead-msg" title="${a(t.brief)}">${a(t.brief)}</p></td></tr>`:""}
      </tbody>`).join("")}
      </table></div>`}wire(){B(this.root,async(e,t)=>{try{await c.patchLead({id:e,status:t}),d("Status updated.")}catch(s){d(s.message,"err")}}),this.root.querySelectorAll("[data-promo]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.promo,s=e.dataset.to==="true";try{await c.patchLead({id:t,promo:s});let n=this._all.find(o=>o._id===t);n&&(n.promo=s),d(s?"Marked as promotion.":"Moved back to leads."),this.render(),this.wire()}catch(n){d(n.message,"err")}})}),this.root.querySelector("#toggle-promos")?.addEventListener("click",()=>{this.showPromos=!this.showPromos,this.render(),this.wire()}),this.root.querySelector("#csv")?.addEventListener("click",()=>this.exportCsv())}exportCsv(){let e=this._all||[],t=["createdAt","name","email","company","role","service","timeSlot","status","emailSent","isPromo","brief"],s=[t.join(",")].concat(e.map(r=>t.map(l=>{let h=l==="isPromo"?f(r)?"yes":"no":r[l];return`"${String(h??"").replace(/"/g,'""')}"`}).join(","))).join(`
`),n=new Blob([s],{type:"text/csv"}),o=document.createElement("a");o.href=URL.createObjectURL(n),o.download="davnoot-leads.csv",o.click(),URL.revokeObjectURL(o.href)}};var R=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await c.listRedirects()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load redirects</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e.redirects),this.wire()}render(e){this.root.innerHTML=`
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
          <td class="url">${a(t.source)}</td>
          <td class="url">${t.status===410?'<span class="pill pill-muted">gone</span>':a(t.destination)}</td>
          <td><span class="pill pill-muted">${t.status}</span></td>
          <td class="cell-count">${t.hits||0}</td>
          <td><button class="btn btn-ghost btn-sm" data-del="${a(t.source)}">Delete</button></td>
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelector("#add")?.addEventListener("click",async()=>{let e=this.root.querySelector("#src").value.trim(),t=this.root.querySelector("#dst").value.trim(),s=Number(this.root.querySelector("#code").value);try{await c.createRedirect({source:e,destination:t,status:s}),d("Redirect added."),this.load()}catch(n){d(n.fields?.source||n.fields?.destination||n.message,"err")}}),this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{if(await u(`Delete the redirect from ${e.dataset.del}?`,{confirmLabel:"Delete",danger:!0}))try{await c.deleteRedirect(e.dataset.del),d("Deleted."),this.load()}catch(t){d(t.message,"err")}})})}};var A=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await c.getSettings()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load settings</h2><p class="muted">${a(t.message)}</p></div>`;return}this.eff=e.effective,this.render(e.effective),this.wire()}render(e){this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Site settings</h1><p class="muted">Brand, contact, and organization details used across the site.</p></div>
        <div class="page-actions"><button class="btn btn-dark" id="save">Save</button></div>
      </header>

      <div class="editor-fields" style="max-width:640px">
        <div class="field-group"><h3>Brand</h3>
          ${m("brand.name","Name",e.brand.name)}
          ${m("brand.wordmark","Wordmark",e.brand.wordmark)}
          ${m("brand.tagline","Tagline",e.brand.tagline)}
        </div>
        <div class="field-group"><h3>Contact</h3>
          ${m("contact.email","Email",e.contact.email)}
          ${m("contact.phone","Phone (E.164)",e.contact.phone)}
          ${m("contact.phoneDisplay","Phone (display)",e.contact.phoneDisplay)}
        </div>
        <div class="field-group"><h3>Organization</h3>
          ${m("org.description","Description",e.org.description,!0)}
          ${m("org.priceRange","Price range",e.org.priceRange)}
          ${m("defaults.siteUrl","Canonical site URL",e.defaults.siteUrl)}
          ${m("defaults.ogImage","Default OG image",e.defaults.ogImage)}
        </div>
      </div>
      <p class="muted small" style="margin-top:14px">Changes are stored as a diff over the built-in defaults. Empty fields fall back to the default.</p>
    `}wire(){this.root.querySelector("#save")?.addEventListener("click",async()=>{let e={};this.root.querySelectorAll("[data-key]").forEach(t=>{ne(e,t.dataset.key,t.value)});try{await c.saveSettings(e),d("Settings saved.")}catch(t){d(t.message,"err")}})}};function m(i,e,t,s){let n=s?`<textarea class="input" rows="3" data-key="${i}">${a(t||"")}</textarea>`:`<input class="input" data-key="${i}" value="${a(t||"")}" />`;return`<div class="field"><label>${a(e)}</label>${n}</div>`}function ne(i,e,t){let s=e.split("."),n=i;for(let o=0;o<s.length-1;o++)(!n[s[o]]||typeof n[s[o]]!="object")&&(n[s[o]]={}),n=n[s[o]];n[s[s.length-1]]=t}var D=class{constructor(e){this.root=e}async mount(){this.root.innerHTML=`
      <div class="empty">
        <h2>Page not found</h2>
        <p class="muted">Nothing lives at <code>${a(location.pathname)}</code>.</p>
        <p><a class="btn btn-dark" href="/admin">Back to overview</a></p>
      </div>`}};var v=P("#app"),w=null;function oe(){let i=location.pathname.replace(/^\/admin\/?/,"").split("/").filter(Boolean);if(!i.length)return{view:"overview"};switch(i[0]){case"pages":return i[1]?{view:"page-editor",key:decodeURIComponent(i.slice(1).join("/"))}:{view:"pages"};case"new":return{view:"page-editor",key:"new"};case"seo":return{view:"seo"};case"leads":return{view:"leads"};case"redirects":return{view:"redirects"};case"settings":return{view:"settings"};default:return{view:"404"}}}var F={overview:()=>new L(v),pages:()=>new E(v),"page-editor":i=>new T(v,{key:i.key}),seo:()=>new x(v),leads:()=>new C(v),redirects:()=>new R(v),settings:()=>new A(v),404:()=>new D(v)};async function M(){w?.destroy?.();let i=oe();w=(F[i.view]||F[404])(i),re(i.view);try{await w.mount()}catch(e){v.innerHTML=`<div class="empty"><h2>Something went wrong</h2><p>${le(e.message)}</p></div>`}}function re(i){for(let e of document.querySelectorAll(".admin-nav a[data-view]"))e.classList.toggle("active",e.dataset.view===i||i==="page-editor"&&e.dataset.view==="pages")}function le(i){let e=document.createElement("div");return e.textContent=String(i??""),e.innerHTML}document.addEventListener("click",async i=>{let e=i.target.closest("a");if(!e)return;let t=e.getAttribute("href");!t?.startsWith("/admin")||e.target==="_blank"||(i.preventDefault(),!(w?.autosave?.hasUnsavedChanges?.()&&!await u("You have unsaved changes. Leave anyway?",{confirmLabel:"Leave",danger:!0}))&&(history.pushState({},"",t),M()))});window.addEventListener("popstate",M);P("#logout")?.addEventListener("click",async()=>{w?.autosave?.hasUnsavedChanges?.()&&!await u("You have unsaved changes. Sign out anyway?",{confirmLabel:"Sign out",danger:!0})||(await c.logout(),location.href="/seoteam/login")});M();})();
