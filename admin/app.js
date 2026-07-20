/*srchash:7f131d916060ce2118d9c22aa3c184e9053421c053f228be9bc6b72c15d0bc4d*/
(()=>{var a=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),U=(s,e=document)=>e.querySelector(s);function I(s){if(!s)return"\u2014";let e=new Date(s);return Number.isNaN(e.getTime())?"\u2014":e.toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"})}function g(s){if(!s)return"\u2014";let e=new Date(s),t=Math.round((Date.now()-e.getTime())/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let i=Math.round(t/60);if(i<24)return`${i}h ago`;let n=Math.round(i/24);return n<30?`${n}d ago`:I(s)}function u(s,{confirmLabel:e="Confirm",danger:t=!1}={}){return new Promise(i=>{let n=document.createElement("div");n.className="modal-backdrop",n.innerHTML=`
      <div class="modal modal-sm" role="dialog" aria-modal="true">
        <p class="modal-msg">${a(s)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${t?"btn-danger":"btn-dark"}" data-act="ok">${a(e)}</button>
        </div>
      </div>`;let o=l=>{n.remove(),document.removeEventListener("keydown",c),i(l)},c=l=>{l.key==="Escape"&&o(!1)};n.addEventListener("click",l=>{(l.target===n||l.target.dataset.act==="cancel")&&o(!1),l.target.dataset.act==="ok"&&o(!0)}),document.addEventListener("keydown",c),document.body.appendChild(n),n.querySelector('[data-act="ok"]').focus()})}function r(s,e="ok"){let t=document.createElement("div");t.className=`toast is-${e}`,t.textContent=s,document.body.appendChild(t),setTimeout(()=>t.classList.add("in"),10),setTimeout(()=>{t.classList.remove("in"),setTimeout(()=>t.remove(),300)},3200)}var w=class extends Error{constructor(e,t,i){super(t),this.status=e,this.fields=i||{}}};async function p(s,e,t,i){let n=await fetch(e,{method:s,headers:{...t?{"Content-Type":"application/json"}:{},...i||{}},body:t?JSON.stringify(t):void 0,credentials:"same-origin"});if(n.status===401){let c=encodeURIComponent(location.pathname+location.search);throw location.href=`/seoteam/login?next=${c}`,new w(401,"Signed out.")}let o=null;try{o=await n.json()}catch{}if(!n.ok)throw new w(n.status,o?.error||`Request failed (${n.status})`,o?.fields);return o}var d={overview:()=>p("GET","/api/admin/overview"),listPages:()=>p("GET","/api/admin/pages"),createPage:s=>p("POST","/api/admin/pages",s),getPage:s=>p("GET",`/api/admin/pages/${encodeURIComponent(s)}`),savePageDraft:(s,e,t)=>p("PUT",`/api/admin/pages/${encodeURIComponent(s)}`,e,t!=null?{"If-Match":String(t)}:null),publishPage:(s,e)=>p("POST",`/api/admin/pages/${encodeURIComponent(s)}/publish`,e||{}),deletePage:s=>p("DELETE",`/api/admin/pages/${encodeURIComponent(s)}`),pageRevisions:s=>p("GET",`/api/admin/pages/${encodeURIComponent(s)}/revisions`),restoreRevision:(s,e)=>p("POST",`/api/admin/pages/${encodeURIComponent(s)}/revisions`,{version:e}),seoTable:()=>p("GET","/api/admin/seo"),patchSeo:s=>p("PATCH","/api/admin/seo",s),listLeads:()=>p("GET","/api/admin/leads"),patchLead:s=>p("PATCH","/api/admin/leads",s),listRedirects:()=>p("GET","/api/admin/redirects"),createRedirect:s=>p("POST","/api/admin/redirects",s),deleteRedirect:s=>p("DELETE",`/api/admin/redirects?source=${encodeURIComponent(s)}`),getSettings:()=>p("GET","/api/admin/settings"),saveSettings:s=>p("PUT","/api/admin/settings",s),audit:()=>p("GET","/api/admin/audit"),logout:()=>p("POST","/api/seoteam/logout",{})};var L=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await d.overview()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the overview</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e)}render(e){this.root.innerHTML=`
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
        <span class="when">${a(g(t.at))}</span>
        <span><strong>${a(t.action)}</strong> \u2014 ${a(t.target)} <span class="muted">${a(t.summary||"")}</span></span>
      </div>`).join("")}</div>`}};function y(s,e,t,i){return`<div class="ov-card">
    <div class="n"${i==="warn"&&s?' style="color:var(--warn)"':""}>${a(s)}</div>
    <div class="l">${a(e)}</div>
    <div class="muted small" style="margin-top:6px">${a(t)}</div>
  </div>`}var S=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await d.listPages()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load pages</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e.pages),this.wire()}render(e){let t=e.filter(n=>n.base),i=e.filter(n=>!n.base);this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Pages</h1><p class="muted">Every URL on the site. The 8 marketing pages are content-editable; new pages get full layout control.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <h2 style="font-size:14px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:6px 0 10px;">Marketing pages</h2>
      ${this.table(t,!1)}

      <h2 style="font-size:14px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:26px 0 10px;">Custom pages</h2>
      ${i.length?this.table(i,!0):'<p class="muted">No custom pages yet. <a href="/admin/new">Create one</a> from a template.</p>'}
    `}table(e,t){return`<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>Title</th><th>URL</th><th>Status</th><th>Edits</th><th>Editable</th><th>Updated</th>${t?"<th></th>":""}</tr></thead>
      <tbody>${e.map(i=>`
        <tr>
          <td><a href="/admin/pages/${encodeURIComponent(i.key)}"><strong>${a(i.title)}</strong></a></td>
          <td><a class="url" href="${a(i.url)}" target="_blank" rel="noopener">${a(i.url)}</a></td>
          <td><span class="pill pill-${N(i.status)}">${a(i.status)}</span></td>
          <td>${i.hasUnpublishedChanges?'<span class="dot-unpub" title="Unpublished changes">\u25CF draft</span>':'<span class="muted small">live</span>'}</td>
          <td>${i.editableSlots!=null?`<span class="cell-count">${i.editableSlots} fields</span>`:'<span class="pill pill-muted">layout</span>'}</td>
          <td class="muted small">${i.updatedAt?a(g(i.updatedAt)):"\u2014"}</td>
          ${t?`<td><button class="btn btn-ghost btn-sm" data-del="${a(i.key)}">Delete</button></td>`:""}
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.del;if(await u(`Delete the page "${t}"? This can't be undone.`,{confirmLabel:"Delete",danger:!0}))try{await d.deletePage(t),r("Page deleted."),this.load()}catch(i){r(i.message,"err")}})})}};function N(s){return s==="live"||s==="published"?"live":s==="archived"?"archived":"draft"}var $={hero:{label:"Hero",fields:[{key:"badge",kind:"inline",label:"Badge"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}],item:null},capabilities:{label:"Capabilities",fields:f(),item:{label:"Card",fields:[{key:"num",kind:"text",label:"Number"},{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"}]}},deliverables:{label:"What's included",fields:[...f(),{key:"intro1",kind:"inline",label:"Intro paragraph 1"},{key:"intro2",kind:"inline",label:"Intro paragraph 2"}],item:{label:"Deliverable",fields:[{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"},{key:"freq",kind:"text",label:"Cadence"}]}},approach:{label:"Approach",fields:f(),item:{label:"Step",fields:[{key:"num",kind:"text",label:"Number"},{key:"label",kind:"inline",label:"Label"},{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"}]}},tiers:{label:"Pricing",fields:f(),item:{label:"Tier",fields:[{key:"featured",kind:"bool",label:"Highlighted"},{key:"name",kind:"inline",label:"Name"},{key:"tagline",kind:"inline",label:"Tagline"},{key:"for",kind:"inline",label:"For"},{key:"timeline",kind:"inline",label:"Timeline"},{key:"includes",kind:"inline-list",label:"Includes (one per line)"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}]}},testimonials:{label:"Testimonials",fields:f(),item:{label:"Quote",fields:[{key:"quote",kind:"inline",label:"Quote"},{key:"avatar",kind:"text",label:"Avatar initials"},{key:"name",kind:"inline",label:"Name"},{key:"role",kind:"inline",label:"Role"}]}},faq:{label:"FAQ",fields:f(),item:{label:"Question",fields:[{key:"q",kind:"inline",label:"Question"},{key:"a",kind:"inline",label:"Answer"}]}},finalCta:{label:"Final CTA",fields:[{key:"eyebrow",kind:"inline",label:"Eyebrow"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}],item:null}};function f(){return[{key:"eyebrow",kind:"inline",label:"Eyebrow"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"}]}var j=Object.keys($),T=class{constructor(e,{key:t}){this.root=e,this.key=t,this.dirty=!1,this.saving=!1,this.values={},this.autosave={hasUnsavedChanges:()=>this.dirty}}destroy(){clearTimeout(this._debounce)}async mount(){if(this.key==="new")return this.renderNew();this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.page=await d.getPage(this.key)}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the page</h2><p class="muted">${a(e.message)}</p></div>`;return}if(this.page.base===null){this.composed=!0,this.sections=Array.isArray(this.page.draft?.sections)?this.page.draft.sections.map(G):[],this.renderComposed();return}this.values=O(this.page.draft),this.render(),this.wire()}render(){let e=_(this.page.slots);this.root.innerHTML=`
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
          ${this.page.slots.length?Object.entries(e).map(([t,i])=>this.group(t,i)).join(""):'<p class="muted">This page has no editable fields yet. Add <code>data-cms</code> annotations to <code>pages/'+a(this.key)+"</code> to expose content here.</p>"}
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>
    `}group(e,t){return`<div class="field-group"><h3>${a(e)}</h3>
      ${t.map(i=>this.field(i)).join("")}
    </div>`}field(e){let t=this.values[e.key]!=null?this.values[e.key]:e.def,i="f_"+e.key.replace(/[^a-z0-9]/gi,"_");return e.kind==="inline"||e.kind==="richtext"?`<div class="field">
        <label>${a(e.label)}</label>
        <div class="inline-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="accent" title="Accent (em)"><em>A</em></button>
        </div>
        <div class="inline-edit" contenteditable="true" data-slot="${a(e.key)}" id="${i}">${t}</div>
      </div>`:`<div class="field">
      <label>${a(e.label)}</label>
      <input class="input" data-slot="${a(e.key)}" id="${i}" value="${a(F(t))}" />
    </div>`}wire(){this.root.querySelectorAll(".inline-toolbar button").forEach(e=>{e.addEventListener("mousedown",t=>{t.preventDefault();let i=e.dataset.cmd;i==="accent"?document.execCommand("italic"):document.execCommand(i)})}),this.root.querySelectorAll("[data-slot]").forEach(e=>{let t=()=>e.isContentEditable?e.innerHTML:e.value,i=()=>{this.values[e.dataset.slot]=t(),this.touch()};e.addEventListener("input",i),e.addEventListener("blur",i)}),this.root.querySelector("#publish")?.addEventListener("click",()=>this.publish()),this.root.querySelector("#revisions")?.addEventListener("click",()=>this.showRevisions())}touch(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.save(),900)}async save(){if(this.saving)return;this.saving=!0,this.setStatus("Saving\u2026","dirty");let e=B(this.values,this.page);e.__version=this.page.version;try{let t=await d.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(t){t.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),r("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),r(t.message,"err"))}finally{this.saving=!1}}async publish(){if(this.dirty&&await this.save(),!!await u("Publish this page? Your draft edits go live within ~60 seconds.",{confirmLabel:"Publish"}))try{await d.publishPage(this.key),r("Published \u2014 live in ~60s."),this.setStatus("Live","saved"),this.page.hasUnpublishedChanges=!1}catch(e){r(e.message,"err")}}async showRevisions(){let e;try{e=await d.pageRevisions(this.key)}catch(i){r(i.message,"err");return}if(!e.revisions.length){r("No revisions yet.");return}let t=e.revisions.map(i=>`v${i.version} \xB7 ${new Date(i.at).toLocaleString()} \xB7 ${i.by}`).join(`
`);if(await u(`Restore the most recent revision into the draft?

${t}`,{confirmLabel:"Restore latest"}))try{await d.restoreRevision(this.key,e.revisions[0].version),r("Restored into draft."),this.mount()}catch(i){r(i.message,"err")}}reloadPreview(){clearTimeout(this._pv),this._pv=setTimeout(()=>{let e=this.root.querySelector("#preview");e&&(e.src=e.src)},400)}setStatus(e,t){let i=this.root.querySelector("#status");i&&(i.textContent=e,i.className="editor-status "+(t||""))}renderComposed(){this.root.innerHTML=`
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
            ${j.map(e=>`<button class="btn btn-ghost btn-add-section" data-type="${e}">+ ${a($[e].label)}</button>`).join("")}
          </div>
          <div id="section-list">${this.sections.map((e,t)=>this.sectionCard(e,t)).join("")||'<p class="muted">No sections yet. Add one above to start building the page.</p>'}</div>
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>`,this.wireComposed()}sectionCard(e,t){let i=$[e.type];if(!i)return"";let n=i.fields.map(c=>this.fieldControl(`s${t}.${c.key}`,c,e.fields?.[c.key])).join(""),o=i.item?`<div class="section-items"><div class="muted small" style="margin:8px 0 4px">${a(i.item.label)}s</div>
          ${(e.items||[]).map((c,l)=>`<div class="section-item">
            <div class="section-item-head"><span class="muted small">${a(i.item.label)} ${l+1}</span><button class="btn-icon btn-del-item" data-s="${t}" data-i="${l}" title="Remove">\u2715</button></div>
            ${i.item.fields.map(h=>this.fieldControl(`s${t}.i${l}.${h.key}`,h,c?.[h.key])).join("")}
          </div>`).join("")}
          <button class="btn btn-ghost btn-add-item" data-s="${t}">+ Add ${a(i.item.label.toLowerCase())}</button></div>`:"";return`<div class="section-card${e.hidden?" is-hidden":""}" data-idx="${t}">
      <div class="section-card-head">
        <strong>${a(i.label)}</strong>
        <div class="section-card-actions">
          <button class="btn-icon btn-move" data-dir="-1" data-s="${t}" title="Move up">\u2191</button>
          <button class="btn-icon btn-move" data-dir="1" data-s="${t}" title="Move down">\u2193</button>
          <button class="btn-icon btn-hide" data-s="${t}" title="${e.hidden?"Show":"Hide"}">${e.hidden?"\u25CC":"\u25CF"}</button>
          <button class="btn-icon btn-del-section" data-s="${t}" title="Remove">\u2715</button>
        </div>
      </div>
      <div class="section-card-body">${n}${o}</div>
    </div>`}fieldControl(e,t,i){let n="f_"+e.replace(/[^a-z0-9]/gi,"_");if(t.kind==="bool")return`<label class="field-inline"><input type="checkbox" data-path="${e}" ${i?"checked":""} /> ${a(t.label)}</label>`;if(t.kind==="inline-list"){let o=Array.isArray(i)?i.join(`
`):"";return`<div class="field"><label>${a(t.label)}</label><textarea class="input" data-path="${e}" data-list="1" rows="3">${a(o)}</textarea></div>`}return t.kind==="richtext"?`<div class="field"><label>${a(t.label)}</label><textarea class="input" data-path="${e}" rows="3">${a(i||"")}</textarea></div>`:`<div class="field"><label>${a(t.label)}</label><input class="input" data-path="${e}" id="${n}" value="${a(i??"")}" /></div>`}wireComposed(){let e=t=>this.root.querySelector(t);this.root.querySelectorAll(".btn-add-section").forEach(t=>t.addEventListener("click",()=>{this.sections.push(z(t.dataset.type)),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-move").forEach(t=>t.addEventListener("click",()=>{let i=+t.dataset.s,n=+t.dataset.dir,o=i+n;o<0||o>=this.sections.length||([this.sections[i],this.sections[o]]=[this.sections[o],this.sections[i]],this.rerenderSections(),this.touchComposed())})),this.root.querySelectorAll(".btn-hide").forEach(t=>t.addEventListener("click",()=>{let i=this.sections[+t.dataset.s];i.hidden=!i.hidden,this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-del-section").forEach(t=>t.addEventListener("click",async()=>{await u("Remove this section?",{confirmLabel:"Remove",danger:!0})&&(this.sections.splice(+t.dataset.s,1),this.rerenderSections(),this.touchComposed())})),this.root.querySelectorAll(".btn-add-item").forEach(t=>t.addEventListener("click",()=>{let i=this.sections[+t.dataset.s];(i.items||(i.items=[])).push({}),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-del-item").forEach(t=>t.addEventListener("click",()=>{this.sections[+t.dataset.s].items.splice(+t.dataset.i,1),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll("[data-path]").forEach(t=>{let i=()=>{this.applyField(t),this.touchComposed()};t.addEventListener("input",i),t.addEventListener("change",i)}),e("#publish")?.addEventListener("click",()=>this.publish()),e("#revisions")?.addEventListener("click",()=>this.showRevisions())}rerenderSections(){let e=this.root.querySelector("#section-list");e&&(e.innerHTML=this.sections.map((t,i)=>this.sectionCard(t,i)).join("")||'<p class="muted">No sections yet. Add one above to start building the page.</p>',this.wireComposedList())}wireComposedList(){let e=(t,i)=>this.root.querySelectorAll("#section-list "+t).forEach(i);e(".btn-move",t=>t.addEventListener("click",()=>{let i=+t.dataset.s,n=i+ +t.dataset.dir;n<0||n>=this.sections.length||([this.sections[i],this.sections[n]]=[this.sections[n],this.sections[i]],this.rerenderSections(),this.touchComposed())})),e(".btn-hide",t=>t.addEventListener("click",()=>{let i=this.sections[+t.dataset.s];i.hidden=!i.hidden,this.rerenderSections(),this.touchComposed()})),e(".btn-del-section",t=>t.addEventListener("click",async()=>{await u("Remove this section?",{confirmLabel:"Remove",danger:!0})&&(this.sections.splice(+t.dataset.s,1),this.rerenderSections(),this.touchComposed())})),e(".btn-add-item",t=>t.addEventListener("click",()=>{let i=this.sections[+t.dataset.s];(i.items||(i.items=[])).push({}),this.rerenderSections(),this.touchComposed()})),e(".btn-del-item",t=>t.addEventListener("click",()=>{this.sections[+t.dataset.s].items.splice(+t.dataset.i,1),this.rerenderSections(),this.touchComposed()})),e("[data-path]",t=>{let i=()=>{this.applyField(t),this.touchComposed()};t.addEventListener("input",i),t.addEventListener("change",i)})}applyField(e){var b,P;let i=e.dataset.path.match(/^s(\d+)(?:\.i(\d+))?\.(.+)$/);if(!i)return;let[,n,o,c]=i,l=this.sections[+n];if(!l)return;let h;e.type==="checkbox"?h=e.checked:e.dataset.list?h=e.value.split(`
`).map(H=>H.trim()).filter(Boolean):h=e.value,o!=null?((b=l.items||(l.items=[]))[P=+o]||(b[P]={}),l.items[+o][c]=h):(l.fields||(l.fields={}))[c]=h}touchComposed(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.saveComposed(),900)}async saveComposed(){if(!this.saving){this.saving=!0,this.setStatus("Saving\u2026","dirty");try{let e={title:this.page.draft?.title||this.key,sections:this.sections},t=await d.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(e){e.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),r("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),r(e.message,"err"))}finally{this.saving=!1}}}renderNew(){this.root.innerHTML=`
      <header class="page-head"><div><h1>New page</h1><p class="muted">Create a custom page at a clean URL.</p></div></header>
      <div class="field-group" style="max-width:520px">
        <div class="field"><label>Title</label><input class="input" id="np-title" placeholder="Pricing" /></div>
        <div class="field"><label>URL slug</label><input class="input" id="np-slug" placeholder="pricing" /><p class="muted small">The page will live at <code>/<span id="np-preview">pricing</span></code></p></div>
        <div class="field"><label>Kind</label><select class="input" id="np-kind">
          <option value="landing">Landing page</option><option value="service">Service page</option>
          <option value="caseStudy">Case study</option><option value="legal">Legal</option></select></div>
        <button class="btn btn-dark" id="np-create">Create</button>
      </div>`;let e=this.root.querySelector("#np-slug");e.addEventListener("input",()=>{this.root.querySelector("#np-preview").textContent=e.value||"slug"}),this.root.querySelector("#np-create").addEventListener("click",async()=>{try{let t=await d.createPage({title:this.root.querySelector("#np-title").value,slug:e.value.trim(),kind:this.root.querySelector("#np-kind").value});r("Page created."),history.pushState({},"",`/admin/pages/${encodeURIComponent(t.key)}`),window.dispatchEvent(new PopStateEvent("popstate"))}catch(t){r(t.fields?.slug||t.message,"err")}})}};function _(s){var t;let e={};for(let i of s)(e[t=i.group]||(e[t]=[])).push(i);return e}function O(s){let e={};for(let[t,i]of Object.entries(s?.seo||{}))i!=null&&(e["seo."+t]=i);for(let t of s?.sections||[])for(let[i,n]of Object.entries(t.fields||{}))n!=null&&(e[i]=n);return e}function B(s,e){let t={},i={};for(let[o,c]of Object.entries(s))o.startsWith("seo.")?t[o.slice(4)]=c:i[o]=c;let n={title:e.draft?.title||"",sections:[{id:"overlay",source:"base",fields:i}]};return Object.keys(t).length&&(n.seo=t),n}function F(s){return String(s||"").replace(/<[^>]+>/g,"")}function z(s){let e=$[s],t={id:s+"-"+Math.random().toString(36).slice(2,8),type:s,source:"library",fields:{}};return e?.item&&(t.items=[{}]),t}function G(s){return{id:s.id,type:s.type,source:s.source||"library",hidden:!!s.hidden,fields:s.fields||{},items:Array.isArray(s.items)?s.items:void 0}}var q=[{id:"all",label:"All"},{id:"no-desc",label:"Missing description",test:s=>!s.metaDescription},{id:"title-len",label:"Title out of range",test:s=>s.titleLen<30||s.titleLen>60},{id:"noindex",label:"Noindexed",test:s=>s.robotsIndex===!1},{id:"dupe-title",label:"Duplicate title"},{id:"off-canon",label:"Off-site canonical",test:s=>s.canonicalUrl&&!s.canonicalUrl.includes("davnoot.com")}],E=class{constructor(e){this.root=e,this.filter="all"}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.data=await d.seoTable()}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the SEO table</h2><p class="muted">${a(e.message)}</p></div>`;return}this.markDuplicates(),this.render(),this.wire()}markDuplicates(){let e=new Map;for(let t of this.data.rows){let i=(t.metaTitle||t.title||"").trim().toLowerCase();i&&e.set(i,(e.get(i)||0)+1)}for(let t of this.data.rows){let i=(t.metaTitle||t.title||"").trim().toLowerCase();t._dupeTitle=i&&e.get(i)>1}}rows(){let e=q.find(t=>t.id===this.filter);return this.filter==="dupe-title"?this.data.rows.filter(t=>t._dupeTitle):e?.test?this.data.rows.filter(e.test):this.data.rows}render(){let e=this.rows();this.root.innerHTML=`
      <header class="page-head">
        <div><h1>SEO</h1><p class="muted">Every URL on the site. Edit inline \u2014 changes to a page land on its draft and go live when you publish it.</p></div>
      </header>
      <div class="table-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${q.map(t=>`<button class="btn btn-sm ${this.filter===t.id?"btn-dark":"btn-ghost"}" data-filter="${t.id}">${a(t.label)}</button>`).join("")}
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
    </tr>`}wire(){this.root.querySelectorAll("[data-filter]").forEach(e=>e.addEventListener("click",()=>{this.filter=e.dataset.filter,this.render(),this.wire()})),this.root.querySelectorAll("tr[data-ref]").forEach(e=>{let[t,i]=e.dataset.ref.split(/:(.+)/);e.querySelectorAll("[data-field]").forEach(n=>{let o=async()=>{let c=n.dataset.field,l=n.value;c==="seo.robotsIndex"&&(l=l===""?null:l==="true");try{await d.patchSeo({type:t,key:i,field:c,value:l}),n.classList.add("saved-flash"),setTimeout(()=>n.classList.remove("saved-flash"),900);let h=this.data.rows.find(b=>`${b.type}:${b.key}`===e.dataset.ref);h&&c==="seo.metaTitle"&&(h.metaTitle=l||""),h&&c==="seo.metaDescription"&&(h.metaDescription=l||"")}catch(h){r(h.fields?.[n.dataset.field]||h.message,"err")}};n.tagName==="SELECT"?n.addEventListener("change",o):(n.addEventListener("blur",o),n.addEventListener("input",()=>this.updateCount(e,n)))})})}updateCount(e,t){if(t.dataset.field==="seo.metaTitle"){let i=e.querySelector('[data-count="title"]');i&&(i.textContent=`${t.value.length}/60`,i.classList.toggle("bad",t.value.length<30||t.value.length>60))}else if(t.dataset.field==="seo.metaDescription"){let i=e.querySelector('[data-count="desc"]');i&&(i.textContent=`${t.value.length}/160`,i.classList.toggle("bad",t.value.length&&(t.value.length<120||t.value.length>160)))}}};var W=["new","contacted","won","lost"],x=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await d.listLeads()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e),this.wire()}render({leads:e,unread:t}){this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${t} new \xB7 ${e.length} total. Every booking is captured here even if the email fails.</p></div>
        <div class="page-actions"><button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      ${e.length?this.table(e):'<div class="empty"><h2>No leads yet</h2><p class="muted">Booking form submissions will appear here.</p></div>'}
    `,this._leads=e}table(e){return`<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>When</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Email</th><th>Status</th></tr></thead>
      <tbody>${e.map(t=>`
        <tr>
          <td class="muted small">${a(g(t.createdAt))}</td>
          <td><strong>${a(t.name)}</strong>${t.company?`<div class="muted small">${a(t.company)}</div>`:""}</td>
          <td><a class="url" href="mailto:${a(t.email)}">${a(t.email)}</a></td>
          <td>${a(t.service||"\u2014")}</td>
          <td class="small">${a(t.timeSlot||"\u2014")}</td>
          <td>${t.emailSent?'<span class="pill pill-ok">sent</span>':'<span class="pill pill-warn">failed</span>'}</td>
          <td><select class="input input-sm" data-status="${a(t._id)}">${W.map(i=>`<option value="${i}" ${t.status===i?"selected":""}>${i}</option>`).join("")}</select></td>
        </tr>${t.brief?`<tr><td></td><td colspan="6" class="muted small" style="padding-top:0">\u201C${a(t.brief)}\u201D</td></tr>`:""}`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelectorAll("[data-status]").forEach(e=>{e.addEventListener("change",async()=>{try{await d.patchLead({id:e.dataset.status,status:e.value}),r("Updated.")}catch(t){r(t.message,"err")}})}),this.root.querySelector("#csv")?.addEventListener("click",()=>this.exportCsv())}exportCsv(){let e=this._leads||[],t=["createdAt","name","email","company","role","service","timeSlot","status","emailSent","brief"],i=[t.join(",")].concat(e.map(c=>t.map(l=>`"${String(c[l]??"").replace(/"/g,'""')}"`).join(","))).join(`
`),n=new Blob([i],{type:"text/csv"}),o=document.createElement("a");o.href=URL.createObjectURL(n),o.download="davnoot-leads.csv",o.click(),URL.revokeObjectURL(o.href)}};var C=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await d.listRedirects()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load redirects</h2><p class="muted">${a(t.message)}</p></div>`;return}this.render(e.redirects),this.wire()}render(e){this.root.innerHTML=`
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
      </tbody></table></div>`}wire(){this.root.querySelector("#add")?.addEventListener("click",async()=>{let e=this.root.querySelector("#src").value.trim(),t=this.root.querySelector("#dst").value.trim(),i=Number(this.root.querySelector("#code").value);try{await d.createRedirect({source:e,destination:t,status:i}),r("Redirect added."),this.load()}catch(n){r(n.fields?.source||n.fields?.destination||n.message,"err")}}),this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{if(await u(`Delete the redirect from ${e.dataset.del}?`,{confirmLabel:"Delete",danger:!0}))try{await d.deleteRedirect(e.dataset.del),r("Deleted."),this.load()}catch(t){r(t.message,"err")}})})}};var R=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await d.getSettings()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load settings</h2><p class="muted">${a(t.message)}</p></div>`;return}this.eff=e.effective,this.render(e.effective),this.wire()}render(e){this.root.innerHTML=`
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
    `}wire(){this.root.querySelector("#save")?.addEventListener("click",async()=>{let e={};this.root.querySelectorAll("[data-key]").forEach(t=>{Q(e,t.dataset.key,t.value)});try{await d.saveSettings(e),r("Settings saved.")}catch(t){r(t.message,"err")}})}};function m(s,e,t,i){let n=i?`<textarea class="input" rows="3" data-key="${s}">${a(t||"")}</textarea>`:`<input class="input" data-key="${s}" value="${a(t||"")}" />`;return`<div class="field"><label>${a(e)}</label>${n}</div>`}function Q(s,e,t){let i=e.split("."),n=s;for(let o=0;o<i.length-1;o++)(!n[i[o]]||typeof n[i[o]]!="object")&&(n[i[o]]={}),n=n[i[o]];n[i[i.length-1]]=t}var D=class{constructor(e){this.root=e}async mount(){this.root.innerHTML=`
      <div class="empty">
        <h2>Page not found</h2>
        <p class="muted">Nothing lives at <code>${a(location.pathname)}</code>.</p>
        <p><a class="btn btn-dark" href="/admin">Back to overview</a></p>
      </div>`}};var v=U("#app"),k=null;function Y(){let s=location.pathname.replace(/^\/admin\/?/,"").split("/").filter(Boolean);if(!s.length)return{view:"overview"};switch(s[0]){case"pages":return s[1]?{view:"page-editor",key:decodeURIComponent(s.slice(1).join("/"))}:{view:"pages"};case"new":return{view:"page-editor",key:"new"};case"seo":return{view:"seo"};case"leads":return{view:"leads"};case"redirects":return{view:"redirects"};case"settings":return{view:"settings"};default:return{view:"404"}}}var M={overview:()=>new L(v),pages:()=>new S(v),"page-editor":s=>new T(v,{key:s.key}),seo:()=>new E(v),leads:()=>new x(v),redirects:()=>new C(v),settings:()=>new R(v),404:()=>new D(v)};async function A(){k?.destroy?.();let s=Y();k=(M[s.view]||M[404])(s),V(s.view);try{await k.mount()}catch(e){v.innerHTML=`<div class="empty"><h2>Something went wrong</h2><p>${K(e.message)}</p></div>`}}function V(s){for(let e of document.querySelectorAll(".admin-nav a[data-view]"))e.classList.toggle("active",e.dataset.view===s||s==="page-editor"&&e.dataset.view==="pages")}function K(s){let e=document.createElement("div");return e.textContent=String(s??""),e.innerHTML}document.addEventListener("click",async s=>{let e=s.target.closest("a");if(!e)return;let t=e.getAttribute("href");!t?.startsWith("/admin")||e.target==="_blank"||(s.preventDefault(),!(k?.autosave?.hasUnsavedChanges?.()&&!await u("You have unsaved changes. Leave anyway?",{confirmLabel:"Leave",danger:!0}))&&(history.pushState({},"",t),A()))});window.addEventListener("popstate",A);U("#logout")?.addEventListener("click",async()=>{k?.autosave?.hasUnsavedChanges?.()&&!await u("You have unsaved changes. Sign out anyway?",{confirmLabel:"Sign out",danger:!0})||(await d.logout(),location.href="/seoteam/login")});A();})();
