/*srchash:12509866b3fe0d6a0fa8a3457c0cfc583ea24acf323bddc643cb1eaa213ebb8c*/
(()=>{var n=a=>String(a??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),D=(a,e=document)=>e.querySelector(a);function W(a){if(!a)return"\u2014";let e=new Date(a);return Number.isNaN(e.getTime())?"\u2014":e.toLocaleDateString("en-CA",{year:"numeric",month:"short",day:"numeric"})}function P(a){if(!a)return"\u2014";let e=new Date(a);return Number.isNaN(e.getTime())?"\u2014":e.toLocaleDateString("en-US",{timeZone:"America/Toronto",month:"short",day:"numeric",year:"numeric"})}function U(a){if(!a)return"";let e=new Date(a);return Number.isNaN(e.getTime())?"":e.toLocaleTimeString("en-US",{timeZone:"America/Toronto",hour:"numeric",minute:"2-digit",hour12:!0})}function w(a){if(!a)return"\u2014";let e=new Date(a),t=Math.round((Date.now()-e.getTime())/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let s=Math.round(t/60);if(s<24)return`${s}h ago`;let i=Math.round(s/24);return i<30?`${i}d ago`:W(a)}function h(a,{confirmLabel:e="Confirm",danger:t=!1}={}){return new Promise(s=>{let i=document.createElement("div");i.className="modal-backdrop",i.innerHTML=`
      <div class="modal modal-sm" role="dialog" aria-modal="true">
        <p class="modal-msg">${n(a)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${t?"btn-danger":"btn-dark"}" data-act="ok">${n(e)}</button>
        </div>
      </div>`;let o=d=>{i.remove(),document.removeEventListener("keydown",l),s(d)},l=d=>{d.key==="Escape"&&o(!1)};i.addEventListener("click",d=>{(d.target===i||d.target.dataset.act==="cancel")&&o(!1),d.target.dataset.act==="ok"&&o(!0)}),document.addEventListener("keydown",l),document.body.appendChild(i),i.querySelector('[data-act="ok"]').focus()})}function r(a,e="ok"){let t=document.createElement("div");t.className=`toast is-${e}`,t.textContent=a,document.body.appendChild(t),setTimeout(()=>t.classList.add("in"),10),setTimeout(()=>{t.classList.remove("in"),setTimeout(()=>t.remove(),300)},3200)}var k=class extends Error{constructor(e,t,s){super(t),this.status=e,this.fields=s||{}}};async function p(a,e,t,s){let i=await fetch(e,{method:a,headers:{...t?{"Content-Type":"application/json"}:{},...s||{}},body:t?JSON.stringify(t):void 0,credentials:"same-origin"});if(i.status===401){let l=encodeURIComponent(location.pathname+location.search);throw location.href=`/seoteam/login?next=${l}`,new k(401,"Signed out.")}let o=null;try{o=await i.json()}catch{}if(!i.ok)throw new k(i.status,o?.error||`Request failed (${i.status})`,o?.fields);return o}var c={overview:()=>p("GET","/api/admin/overview"),listPages:()=>p("GET","/api/admin/pages"),createPage:a=>p("POST","/api/admin/pages",a),getPage:a=>p("GET",`/api/admin/pages/${encodeURIComponent(a)}`),savePageDraft:(a,e,t)=>p("PUT",`/api/admin/pages/${encodeURIComponent(a)}`,e,t!=null?{"If-Match":String(t)}:null),publishPage:(a,e)=>p("POST",`/api/admin/pages/${encodeURIComponent(a)}/publish`,e||{}),deletePage:a=>p("DELETE",`/api/admin/pages/${encodeURIComponent(a)}`),pageRevisions:a=>p("GET",`/api/admin/pages/${encodeURIComponent(a)}/revisions`),restoreRevision:(a,e)=>p("POST",`/api/admin/pages/${encodeURIComponent(a)}/revisions`,{version:e}),seoTable:()=>p("GET","/api/admin/seo"),patchSeo:a=>p("PATCH","/api/admin/seo",a),listLeads:()=>p("GET","/api/admin/leads"),patchLead:a=>p("PATCH","/api/admin/leads",a),deleteLeads:a=>p("DELETE","/api/admin/leads",a),listRedirects:()=>p("GET","/api/admin/redirects"),createRedirect:a=>p("POST","/api/admin/redirects",a),deleteRedirect:a=>p("DELETE",`/api/admin/redirects?source=${encodeURIComponent(a)}`),getSettings:()=>p("GET","/api/admin/settings"),saveSettings:a=>p("PUT","/api/admin/settings",a),audit:()=>p("GET","/api/admin/audit"),logout:()=>p("POST","/api/seoteam/logout",{})};var S=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await c.overview()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the overview</h2><p class="muted">${n(t.message)}</p></div>`;return}this.render(e)}render(e){this.root.innerHTML=`
      ${e.previewEnv?'<div class="preview-banner" role="alert">\u26A0 PREVIEW deployment \u2014 you are editing the <strong>preview</strong> database. Publishing here does <strong>not</strong> change the live site.</div>':""}
      <header class="page-head">
        <div><h1>Overview</h1><p class="muted">Signed in as <strong>${n(e.role)}</strong>.</p></div>
        <div class="page-actions"><a class="btn btn-dark" href="/admin/new">New page</a></div>
      </header>

      <div class="ov-grid">
        ${g(e.pages.total,"Pages",`${e.pages.marketing} marketing \xB7 ${e.pages.composed} custom`)}
        ${g(e.pages.unpublishedDrafts,"Unpublished drafts","pages with pending edits")}
        ${g(e.posts.published,"Blog posts",`${e.posts.draft} drafts`)}
        ${g(e.leads.unread,"New leads",e.leads.unread?"awaiting a reply":"inbox clear",e.leads.unread?"warn":"")}
        ${g(e.media.total,"Media","in the library")}
      </div>

      <h2 style="font-size:15px;margin:0 0 10px;">Recent activity</h2>
      ${e.activity.length?this.feed(e.activity):'<p class="muted">No activity yet.</p>'}
    `}feed(e){return`<div class="feed">${e.map(t=>`
      <div class="feed-row">
        <span class="when">${n(w(t.at))}</span>
        <span><strong>${n(t.action)}</strong> \u2014 ${n(t.target)} <span class="muted">${n(t.summary||"")}</span></span>
      </div>`).join("")}</div>`}};function g(a,e,t,s){return`<div class="ov-card">
    <div class="n"${s==="warn"&&a?' style="color:var(--warn)"':""}>${n(a)}</div>
    <div class="l">${n(e)}</div>
    <div class="muted small" style="margin-top:6px">${n(t)}</div>
  </div>`}var L=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await c.listPages()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load pages</h2><p class="muted">${n(t.message)}</p></div>`;return}this.render(e.pages),this.wire()}render(e){let t=e.filter(i=>i.base),s=e.filter(i=>!i.base);this.root.innerHTML=`
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
          <td><a href="/admin/pages/${encodeURIComponent(s.key)}"><strong>${n(s.title)}</strong></a></td>
          <td><a class="url" href="${n(s.url)}" target="_blank" rel="noopener">${n(s.url)}</a></td>
          <td><span class="pill pill-${Y(s.status)}">${n(s.status)}</span></td>
          <td>${s.hasUnpublishedChanges?'<span class="dot-unpub" title="Unpublished changes">\u25CF draft</span>':'<span class="muted small">live</span>'}</td>
          <td>${s.editableSlots!=null?`<span class="cell-count">${s.editableSlots} fields</span>`:'<span class="pill pill-muted">layout</span>'}</td>
          <td class="muted small">${s.updatedAt?n(w(s.updatedAt)):"\u2014"}</td>
          ${t?`<td><button class="btn btn-ghost btn-sm" data-del="${n(s.key)}">Delete</button></td>`:""}
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.del;if(await h(`Delete the page "${t}"? This can't be undone.`,{confirmLabel:"Delete",danger:!0}))try{await c.deletePage(t),r("Page deleted."),this.load()}catch(s){r(s.message,"err")}})})}};function Y(a){return a==="live"||a==="published"?"live":a==="archived"?"archived":"draft"}var y={hero:{label:"Hero",fields:[{key:"badge",kind:"inline",label:"Badge"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}],item:null},capabilities:{label:"Capabilities",fields:b(),item:{label:"Card",fields:[{key:"num",kind:"text",label:"Number"},{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"}]}},deliverables:{label:"What's included",fields:[...b(),{key:"intro1",kind:"inline",label:"Intro paragraph 1"},{key:"intro2",kind:"inline",label:"Intro paragraph 2"}],item:{label:"Deliverable",fields:[{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"},{key:"freq",kind:"text",label:"Cadence"}]}},approach:{label:"Approach",fields:b(),item:{label:"Step",fields:[{key:"num",kind:"text",label:"Number"},{key:"label",kind:"inline",label:"Label"},{key:"title",kind:"inline",label:"Title"},{key:"desc",kind:"inline",label:"Description"}]}},tiers:{label:"Pricing",fields:b(),item:{label:"Tier",fields:[{key:"featured",kind:"bool",label:"Highlighted"},{key:"name",kind:"inline",label:"Name"},{key:"tagline",kind:"inline",label:"Tagline"},{key:"for",kind:"inline",label:"For"},{key:"timeline",kind:"inline",label:"Timeline"},{key:"includes",kind:"inline-list",label:"Includes (one per line)"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}]}},testimonials:{label:"Testimonials",fields:b(),item:{label:"Quote",fields:[{key:"quote",kind:"inline",label:"Quote"},{key:"avatar",kind:"text",label:"Avatar initials"},{key:"name",kind:"inline",label:"Name"},{key:"role",kind:"inline",label:"Role"}]}},faq:{label:"FAQ",fields:b(),item:{label:"Question",fields:[{key:"q",kind:"inline",label:"Question"},{key:"a",kind:"inline",label:"Answer"}]}},finalCta:{label:"Final CTA",fields:[{key:"eyebrow",kind:"inline",label:"Eyebrow"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"},{key:"ctaHref",kind:"url",label:"Button link"},{key:"ctaLabel",kind:"inline",label:"Button label"}],item:null}};function b(){return[{key:"eyebrow",kind:"inline",label:"Eyebrow"},{key:"title",kind:"inline",label:"Title"},{key:"sub",kind:"inline",label:"Subtitle"}]}var Q=Object.keys(y),E=class{constructor(e,{key:t}){this.root=e,this.key=t,this.dirty=!1,this.saving=!1,this.values={},this.autosave={hasUnsavedChanges:()=>this.dirty}}destroy(){clearTimeout(this._debounce)}async mount(){if(this.key==="new")return this.renderNew();this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.page=await c.getPage(this.key)}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the page</h2><p class="muted">${n(e.message)}</p></div>`;return}if(this.page.base===null){this.composed=!0,this.sections=Array.isArray(this.page.draft?.sections)?this.page.draft.sections.map(ee):[],this.renderComposed();return}this.values=K(this.page.draft),this.render(),this.wire()}render(){let e=V(this.page.slots);this.root.innerHTML=`
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">\u2190 Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${n(this.page.draft.title||this.key)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="editor-status" id="status">${this.page.hasUnpublishedChanges?"Unpublished changes":"Live"}</span>
          <button class="btn btn-ghost" id="revisions">History</button>
          <button class="btn btn-dark" id="publish">Publish</button>
        </div>
      </div>

      <div class="editor-split">
        <div class="editor-fields">
          ${this.page.slots.length?Object.entries(e).map(([t,s])=>this.group(t,s)).join(""):'<p class="muted">This page has no editable fields yet. Add <code>data-cms</code> annotations to <code>pages/'+n(this.key)+"</code> to expose content here.</p>"}
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>
    `}group(e,t){return`<div class="field-group"><h3>${n(e)}</h3>
      ${t.map(s=>this.field(s)).join("")}
    </div>`}field(e){let t=this.values[e.key]!=null?this.values[e.key]:e.def,s="f_"+e.key.replace(/[^a-z0-9]/gi,"_");return e.kind==="inline"||e.kind==="richtext"?`<div class="field">
        <label>${n(e.label)}</label>
        <div class="inline-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="accent" title="Accent (em)"><em>A</em></button>
        </div>
        <div class="inline-edit" contenteditable="true" data-slot="${n(e.key)}" id="${s}">${t}</div>
      </div>`:`<div class="field">
      <label>${n(e.label)}</label>
      <input class="input" data-slot="${n(e.key)}" id="${s}" value="${n(J(t))}" />
    </div>`}wire(){this.root.querySelectorAll(".inline-toolbar button").forEach(e=>{e.addEventListener("mousedown",t=>{t.preventDefault();let s=e.dataset.cmd;s==="accent"?document.execCommand("italic"):document.execCommand(s)})}),this.root.querySelectorAll("[data-slot]").forEach(e=>{let t=()=>e.isContentEditable?e.innerHTML:e.value,s=()=>{this.values[e.dataset.slot]=t(),this.touch()};e.addEventListener("input",s),e.addEventListener("blur",s)}),this.root.querySelector("#publish")?.addEventListener("click",()=>this.publish()),this.root.querySelector("#revisions")?.addEventListener("click",()=>this.showRevisions())}touch(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.save(),900)}async save(){if(this.saving)return;this.saving=!0,this.setStatus("Saving\u2026","dirty");let e=Z(this.values,this.page);e.__version=this.page.version;try{let t=await c.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(t){t.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),r("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),r(t.message,"err"))}finally{this.saving=!1}}async publish(){if(this.dirty&&await this.save(),!!await h("Publish this page? Your draft edits go live within ~60 seconds.",{confirmLabel:"Publish"}))try{await c.publishPage(this.key),r("Published \u2014 live in ~60s."),this.setStatus("Live","saved"),this.page.hasUnpublishedChanges=!1}catch(e){r(e.message,"err")}}async showRevisions(){let e;try{e=await c.pageRevisions(this.key)}catch(s){r(s.message,"err");return}if(!e.revisions.length){r("No revisions yet.");return}let t=e.revisions.map(s=>`v${s.version} \xB7 ${new Date(s.at).toLocaleString()} \xB7 ${s.by}`).join(`
`);if(await h(`Restore the most recent revision into the draft?

${t}`,{confirmLabel:"Restore latest"}))try{await c.restoreRevision(this.key,e.revisions[0].version),r("Restored into draft."),this.mount()}catch(s){r(s.message,"err")}}reloadPreview(){clearTimeout(this._pv),this._pv=setTimeout(()=>{let e=this.root.querySelector("#preview");e&&(e.src=e.src)},400)}setStatus(e,t){let s=this.root.querySelector("#status");s&&(s.textContent=e,s.className="editor-status "+(t||""))}renderComposed(){this.root.innerHTML=`
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">\u2190 Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${n(this.page.draft?.title||this.key)}</h1>
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
            ${Q.map(e=>`<button class="btn btn-ghost btn-add-section" data-type="${e}">+ ${n(y[e].label)}</button>`).join("")}
          </div>
          <div id="section-list">${this.sections.map((e,t)=>this.sectionCard(e,t)).join("")||'<p class="muted">No sections yet. Add one above to start building the page.</p>'}</div>
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>`,this.wireComposed()}sectionCard(e,t){let s=y[e.type];if(!s)return"";let i=s.fields.map(l=>this.fieldControl(`s${t}.${l.key}`,l,e.fields?.[l.key])).join(""),o=s.item?`<div class="section-items"><div class="muted small" style="margin:8px 0 4px">${n(s.item.label)}s</div>
          ${(e.items||[]).map((l,d)=>`<div class="section-item">
            <div class="section-item-head"><span class="muted small">${n(s.item.label)} ${d+1}</span><button class="btn-icon btn-del-item" data-s="${t}" data-i="${d}" title="Remove">\u2715</button></div>
            ${s.item.fields.map(u=>this.fieldControl(`s${t}.i${d}.${u.key}`,u,l?.[u.key])).join("")}
          </div>`).join("")}
          <button class="btn btn-ghost btn-add-item" data-s="${t}">+ Add ${n(s.item.label.toLowerCase())}</button></div>`:"";return`<div class="section-card${e.hidden?" is-hidden":""}" data-idx="${t}">
      <div class="section-card-head">
        <strong>${n(s.label)}</strong>
        <div class="section-card-actions">
          <button class="btn-icon btn-move" data-dir="-1" data-s="${t}" title="Move up">\u2191</button>
          <button class="btn-icon btn-move" data-dir="1" data-s="${t}" title="Move down">\u2193</button>
          <button class="btn-icon btn-hide" data-s="${t}" title="${e.hidden?"Show":"Hide"}">${e.hidden?"\u25CC":"\u25CF"}</button>
          <button class="btn-icon btn-del-section" data-s="${t}" title="Remove">\u2715</button>
        </div>
      </div>
      <div class="section-card-body">${i}${o}</div>
    </div>`}fieldControl(e,t,s){let i="f_"+e.replace(/[^a-z0-9]/gi,"_");if(t.kind==="bool")return`<label class="field-inline"><input type="checkbox" data-path="${e}" ${s?"checked":""} /> ${n(t.label)}</label>`;if(t.kind==="inline-list"){let o=Array.isArray(s)?s.join(`
`):"";return`<div class="field"><label>${n(t.label)}</label><textarea class="input" data-path="${e}" data-list="1" rows="3">${n(o)}</textarea></div>`}return t.kind==="richtext"?`<div class="field"><label>${n(t.label)}</label><textarea class="input" data-path="${e}" rows="3">${n(s||"")}</textarea></div>`:`<div class="field"><label>${n(t.label)}</label><input class="input" data-path="${e}" id="${i}" value="${n(s??"")}" /></div>`}wireComposed(){let e=t=>this.root.querySelector(t);this.root.querySelectorAll(".btn-add-section").forEach(t=>t.addEventListener("click",()=>{this.sections.push(X(t.dataset.type)),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-move").forEach(t=>t.addEventListener("click",()=>{let s=+t.dataset.s,i=+t.dataset.dir,o=s+i;o<0||o>=this.sections.length||([this.sections[s],this.sections[o]]=[this.sections[o],this.sections[s]],this.rerenderSections(),this.touchComposed())})),this.root.querySelectorAll(".btn-hide").forEach(t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];s.hidden=!s.hidden,this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-del-section").forEach(t=>t.addEventListener("click",async()=>{await h("Remove this section?",{confirmLabel:"Remove",danger:!0})&&(this.sections.splice(+t.dataset.s,1),this.rerenderSections(),this.touchComposed())})),this.root.querySelectorAll(".btn-add-item").forEach(t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];(s.items||(s.items=[])).push({}),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll(".btn-del-item").forEach(t=>t.addEventListener("click",()=>{this.sections[+t.dataset.s].items.splice(+t.dataset.i,1),this.rerenderSections(),this.touchComposed()})),this.root.querySelectorAll("[data-path]").forEach(t=>{let s=()=>{this.applyField(t),this.touchComposed()};t.addEventListener("input",s),t.addEventListener("change",s)}),e("#publish")?.addEventListener("click",()=>this.publish()),e("#revisions")?.addEventListener("click",()=>this.showRevisions())}rerenderSections(){let e=this.root.querySelector("#section-list");e&&(e.innerHTML=this.sections.map((t,s)=>this.sectionCard(t,s)).join("")||'<p class="muted">No sections yet. Add one above to start building the page.</p>',this.wireComposedList())}wireComposedList(){let e=(t,s)=>this.root.querySelectorAll("#section-list "+t).forEach(s);e(".btn-move",t=>t.addEventListener("click",()=>{let s=+t.dataset.s,i=s+ +t.dataset.dir;i<0||i>=this.sections.length||([this.sections[s],this.sections[i]]=[this.sections[i],this.sections[s]],this.rerenderSections(),this.touchComposed())})),e(".btn-hide",t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];s.hidden=!s.hidden,this.rerenderSections(),this.touchComposed()})),e(".btn-del-section",t=>t.addEventListener("click",async()=>{await h("Remove this section?",{confirmLabel:"Remove",danger:!0})&&(this.sections.splice(+t.dataset.s,1),this.rerenderSections(),this.touchComposed())})),e(".btn-add-item",t=>t.addEventListener("click",()=>{let s=this.sections[+t.dataset.s];(s.items||(s.items=[])).push({}),this.rerenderSections(),this.touchComposed()})),e(".btn-del-item",t=>t.addEventListener("click",()=>{this.sections[+t.dataset.s].items.splice(+t.dataset.i,1),this.rerenderSections(),this.touchComposed()})),e("[data-path]",t=>{let s=()=>{this.applyField(t),this.touchComposed()};t.addEventListener("input",s),t.addEventListener("change",s)})}applyField(e){var f,j;let s=e.dataset.path.match(/^s(\d+)(?:\.i(\d+))?\.(.+)$/);if(!s)return;let[,i,o,l]=s,d=this.sections[+i];if(!d)return;let u;e.type==="checkbox"?u=e.checked:e.dataset.list?u=e.value.split(`
`).map(z=>z.trim()).filter(Boolean):u=e.value,o!=null?((f=d.items||(d.items=[]))[j=+o]||(f[j]={}),d.items[+o][l]=u):(d.fields||(d.fields={}))[l]=u}touchComposed(){this.dirty=!0,this.setStatus("Unsaved\u2026","dirty"),clearTimeout(this._debounce),this._debounce=setTimeout(()=>this.saveComposed(),900)}async saveComposed(){if(!this.saving){this.saving=!0,this.setStatus("Saving\u2026","dirty");try{let e={title:this.page.draft?.title||this.key,sections:this.sections},t=await c.savePageDraft(this.key,e,this.page.version);this.page.version=t.version,this.dirty=!1,this.setStatus("Saved to draft","saved"),this.reloadPreview()}catch(e){e.status===409?(this.setStatus("Someone else saved \u2014 reload","dirty"),r("This page changed elsewhere. Reload to continue.","err")):(this.setStatus("Save failed","dirty"),r(e.message,"err"))}finally{this.saving=!1}}}renderNew(){this.root.innerHTML=`
      <header class="page-head"><div><h1>New page</h1><p class="muted">Create a custom page at a clean URL.</p></div></header>
      <div class="field-group" style="max-width:520px">
        <div class="field"><label>Title</label><input class="input" id="np-title" placeholder="Pricing" /></div>
        <div class="field"><label>URL slug</label><input class="input" id="np-slug" placeholder="pricing" /><p class="muted small">The page will live at <code>/<span id="np-preview">pricing</span></code></p></div>
        <div class="field"><label>Kind</label><select class="input" id="np-kind">
          <option value="landing">Landing page</option><option value="service">Service page</option>
          <option value="caseStudy">Case study</option><option value="legal">Legal</option></select></div>
        <button class="btn btn-dark" id="np-create">Create</button>
      </div>`;let e=this.root.querySelector("#np-slug");e.addEventListener("input",()=>{this.root.querySelector("#np-preview").textContent=e.value||"slug"}),this.root.querySelector("#np-create").addEventListener("click",async()=>{try{let t=await c.createPage({title:this.root.querySelector("#np-title").value,slug:e.value.trim(),kind:this.root.querySelector("#np-kind").value});r("Page created."),history.pushState({},"",`/admin/pages/${encodeURIComponent(t.key)}`),window.dispatchEvent(new PopStateEvent("popstate"))}catch(t){r(t.fields?.slug||t.message,"err")}})}};function V(a){var t;let e={};for(let s of a)(e[t=s.group]||(e[t]=[])).push(s);return e}function K(a){let e={};for(let[t,s]of Object.entries(a?.seo||{}))s!=null&&(e["seo."+t]=s);for(let t of a?.sections||[])for(let[s,i]of Object.entries(t.fields||{}))i!=null&&(e[s]=i);return e}function Z(a,e){let t={},s={};for(let[o,l]of Object.entries(a))o.startsWith("seo.")?t[o.slice(4)]=l:s[o]=l;let i={title:e.draft?.title||"",sections:[{id:"overlay",source:"base",fields:s}]};return Object.keys(t).length&&(i.seo=t),i}function J(a){return String(a||"").replace(/<[^>]+>/g,"")}function X(a){let e=y[a],t={id:a+"-"+Math.random().toString(36).slice(2,8),type:a,source:"library",fields:{}};return e?.item&&(t.items=[{}]),t}function ee(a){return{id:a.id,type:a.type,source:a.source||"library",hidden:!!a.hidden,fields:a.fields||{},items:Array.isArray(a.items)?a.items:void 0}}var H=[{id:"all",label:"All"},{id:"no-desc",label:"Missing description",test:a=>!a.metaDescription},{id:"title-len",label:"Title out of range",test:a=>a.titleLen<30||a.titleLen>60},{id:"noindex",label:"Noindexed",test:a=>a.robotsIndex===!1},{id:"dupe-title",label:"Duplicate title"},{id:"off-canon",label:"Off-site canonical",test:a=>a.canonicalUrl&&!a.canonicalUrl.includes("davnoot.com")}],x=class{constructor(e){this.root=e,this.filter="all"}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';try{this.data=await c.seoTable()}catch(e){this.root.innerHTML=`<div class="empty"><h2>Couldn't load the SEO table</h2><p class="muted">${n(e.message)}</p></div>`;return}this.markDuplicates(),this.render(),this.wire()}markDuplicates(){let e=new Map;for(let t of this.data.rows){let s=(t.metaTitle||t.title||"").trim().toLowerCase();s&&e.set(s,(e.get(s)||0)+1)}for(let t of this.data.rows){let s=(t.metaTitle||t.title||"").trim().toLowerCase();t._dupeTitle=s&&e.get(s)>1}}rows(){let e=H.find(t=>t.id===this.filter);return this.filter==="dupe-title"?this.data.rows.filter(t=>t._dupeTitle):e?.test?this.data.rows.filter(e.test):this.data.rows}render(){let e=this.rows();this.root.innerHTML=`
      <header class="page-head">
        <div><h1>SEO</h1><p class="muted">Every URL on the site. Edit inline \u2014 changes to a page land on its draft and go live when you publish it.</p></div>
      </header>
      <div class="table-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${H.map(t=>`<button class="btn btn-sm ${this.filter===t.id?"btn-dark":"btn-ghost"}" data-filter="${t.id}">${n(t.label)}</button>`).join("")}
      </div>
      <div class="table-scroll"><table class="grid-table">
        <thead><tr><th>URL</th><th>Meta title</th><th>Meta description</th><th>Robots</th><th>Canonical</th><th></th></tr></thead>
        <tbody>${e.map(t=>this.row(t)).join("")}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">${e.length} of ${this.data.rows.length} URLs.</p>
    `}row(e){let t=`${e.type}:${e.key}`;return`<tr data-ref="${n(t)}">
      <td>
        <a class="url" href="${n(e.url)}" target="_blank" rel="noopener">${n(e.url)}</a>
        <div class="small">${e.type==="post"?'<span class="pill pill-muted">post</span>':'<span class="pill pill-muted">page</span>'} ${e.seoReady?'<span class="pill pill-ok">SEO ready</span>':""} ${e._dupeTitle?'<span class="pill pill-warn">dupe title</span>':""}</div>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaTitle" value="${n(e.metaTitle)}" placeholder="${n(e.title)}" />
        <span class="cell-count ${e.titleLen<30||e.titleLen>60?"bad":""}" data-count="title">${e.titleLen}/60</span>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaDescription" value="${n(e.metaDescription)}" placeholder="\u2014" />
        <span class="cell-count ${e.descLen&&(e.descLen<120||e.descLen>160)?"bad":""}" data-count="desc">${e.descLen}/160</span>
      </td>
      <td>
        <select class="cell-edit" data-field="seo.robotsIndex">
          <option value="" ${e.robotsIndex===void 0?"selected":""}>Default (index)</option>
          <option value="true" ${e.robotsIndex===!0?"selected":""}>index</option>
          <option value="false" ${e.robotsIndex===!1?"selected":""}>noindex</option>
        </select>
      </td>
      <td><input class="cell-edit" data-field="seo.canonicalUrl" value="${n(e.canonicalUrl)}" placeholder="\u2014" style="min-width:150px" /></td>
      <td><a class="btn btn-ghost btn-sm" href="${n(e.editUrl)}"${e.type==="post"?' target="_blank" rel="noopener"':""}>Edit</a></td>
    </tr>`}wire(){this.root.querySelectorAll("[data-filter]").forEach(e=>e.addEventListener("click",()=>{this.filter=e.dataset.filter,this.render(),this.wire()})),this.root.querySelectorAll("tr[data-ref]").forEach(e=>{let[t,s]=e.dataset.ref.split(/:(.+)/);e.querySelectorAll("[data-field]").forEach(i=>{let o=async()=>{let l=i.dataset.field,d=i.value;l==="seo.robotsIndex"&&(d=d===""?null:d==="true");try{await c.patchSeo({type:t,key:s,field:l,value:d}),i.classList.add("saved-flash"),setTimeout(()=>i.classList.remove("saved-flash"),900);let u=this.data.rows.find(f=>`${f.type}:${f.key}`===e.dataset.ref);u&&l==="seo.metaTitle"&&(u.metaTitle=d||""),u&&l==="seo.metaDescription"&&(u.metaDescription=d||"")}catch(u){r(u.fields?.[i.dataset.field]||u.message,"err")}};i.tagName==="SELECT"?i.addEventListener("change",o):(i.addEventListener("blur",o),i.addEventListener("input",()=>this.updateCount(e,i)))})})}updateCount(e,t){if(t.dataset.field==="seo.metaTitle"){let s=e.querySelector('[data-count="title"]');s&&(s.textContent=`${t.value.length}/60`,s.classList.toggle("bad",t.value.length<30||t.value.length>60))}else if(t.dataset.field==="seo.metaDescription"){let s=e.querySelector('[data-count="desc"]');s&&(s.textContent=`${t.value.length}/160`,s.classList.toggle("bad",t.value.length&&(t.value.length<120||t.value.length>160)))}}};function O({value:a,options:e,id:t="",cls:s="",ariaLabel:i=""}){let o=e.find(l=>l.value===a)||e[0]||{label:""};return`<div class="cdrop${s?" "+s:""}" data-cdrop${t?` data-id="${n(t)}"`:""} data-value="${n(a??"")}">
    <button type="button" class="cdrop-btn" aria-haspopup="listbox" aria-expanded="false"${i?` aria-label="${n(i)}"`:""}>
      <span class="cdrop-label">${n(o.label)}</span>
      <svg class="cdrop-caret" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <ul class="cdrop-menu" role="listbox" hidden>
      ${e.map(l=>`<li role="option" class="cdrop-opt${l.value===a?" is-selected":""}" data-val="${n(l.value)}">${n(l.label)}</li>`).join("")}
    </ul>
  </div>`}function q(a,e){a.classList.toggle("is-open",e);let t=a.querySelector(".cdrop-btn"),s=a.querySelector(".cdrop-menu");t&&t.setAttribute("aria-expanded",e?"true":"false"),s&&(s.hidden=!e)}function N(){document.querySelectorAll(".cdrop.is-open").forEach(a=>q(a,!1))}var _=!1;function te(){_||(_=!0,document.addEventListener("click",a=>{a.target.closest(".cdrop")||N()}),document.addEventListener("keydown",a=>{a.key==="Escape"&&N()}))}function B(a,e){te(),a.addEventListener("click",t=>{let s=t.target.closest(".cdrop-btn");if(s&&a.contains(s)){let o=s.closest(".cdrop"),l=!o.classList.contains("is-open");N(),q(o,l);return}let i=t.target.closest(".cdrop-opt");if(i&&a.contains(i)){let o=i.closest(".cdrop"),l=i.dataset.val;q(o,!1),l!==o.dataset.value&&(o.dataset.value=l,o.querySelector(".cdrop-label").textContent=i.textContent,o.querySelectorAll(".cdrop-opt").forEach(d=>d.classList.toggle("is-selected",d===i)),e?.(o.dataset.id||"",l,o))}})}var se=["new","contacted","won","lost"],ae=a=>a&&a[0].toUpperCase()+a.slice(1),ie={seo:"SEO",meta:"Meta Ads",email:"Email Marketing","ai-seo":"AI SEO","chatgpt-ads":"ChatGPT / AI Ads",software:"Custom Software",multi:"Multi-channel"},F={},M={},ne=[{key:"inbox",label:"Inbox"},{key:"spam",label:"Spam"},{key:"blocked",label:"Blocked"}],T=class a{constructor(e){this.root=e,this.tab="inbox",this.source="all"}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await c.listLeads()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${n(t.message)}</p></div>`;return}this._all=e.leads||[],this._blocked=e.blocked||[],this._sources=e.sources||[],F=Object.fromEntries((e.categories||[]).map(t=>[t.key,t.label])),M=Object.fromEntries(this._sources.map(t=>[t.key,t.label])),this.render(),this.wire()}counts(){let e=this._all.filter(t=>!t.spam);return{inbox:e.length,spam:this._all.length-e.length,blocked:this._blocked.length,newReal:e.filter(t=>t.status==="new").length}}visible(){let e=this.tab==="blocked"?this._blocked:this._all.filter(t=>this.tab==="spam"?t.spam:!t.spam);return this.source==="all"?e:e.filter(t=>t.source===this.source)}render(){let e=this.counts(),t=this.visible(),s={inbox:`${e.newReal} new \xB7 ${e.inbox} real ${e.inbox===1?"lead":"leads"}. Captured even when the email fails.`,spam:"Caught by the filter and never emailed. Nothing here was deleted \u2014 if one is real, put it back.",blocked:"Rejected before reaching the inbox. Kept 30 days so a wrong call can be spotted, then swept automatically."}[this.tab],i=this.tab==="spam"&&e.spam?'<button class="btn btn-ghost" id="purge">Delete all spam</button>':"";this.root.innerHTML=`
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${n(s)}</p></div>
        <div class="page-actions">${i}<button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      <nav class="lead-tabs">
        ${ne.map(o=>`<button type="button" class="lead-tab${this.tab===o.key?" is-active":""}" data-tab="${o.key}">${o.label}<span class="lead-tab-n">${e[o.key]}</span></button>`).join("")}
      </nav>
      ${this.sourceFilter()}
      ${t.length?this.tab==="blocked"?this.blockedTable(t):this.table(t):this.emptyState()}
    `}sourceFilter(){let e=this.tab==="blocked"?this._blocked:this._all,t=this._sources.filter(i=>e.some(o=>o.source===i.key));if(t.length<2)return"";let s=(i,o)=>`<button type="button" class="lead-src${this.source===i?" is-active":""}" data-src="${n(i)}">${n(o)}</button>`;return`<div class="lead-sources">${s("all","All sources")}${t.map(i=>s(i.key,i.label)).join("")}</div>`}emptyState(){if(this.source!=="all"){let t=M[this.source]||this.source;return`<div class="empty"><h2>Nothing from ${n(t)}</h2><p class="muted">Other sources may still have submissions \u2014 switch back to All sources.</p></div>`}let e={inbox:["No leads yet","Booking form and blog teardown submissions will appear here."],spam:["Nothing in spam","Submissions the filter catches will collect here instead of your inbox."],blocked:["Nothing blocked","Rejected submissions appear here for 30 days."]}[this.tab];return`<div class="empty"><h2>${e[0]}</h2><p class="muted">${e[1]}</p></div>`}static why(e){return!e.spamReasons||!e.spamReasons.length?"":`<div class="lead-why">${n(e.spamReasons.join(" \xB7 "))}${e.spamScore!=null?` <span class="muted">(score ${n(String(e.spamScore))})</span>`:""}</div>`}static categoryPill(e){return e.spamCategory?`<span class="pill pill-spam">${n(F[e.spamCategory]||e.spamCategory)}</span>`:""}static sourcePill(e){let t=M[e.source];return t?`<span class="pill pill-src pill-src-${n(e.source)}">${n(t)}</span>`:""}static emailPill(e){return e.emailSent===!0?'<span class="pill pill-ok">sent</span>':e.emailSent===null||e.emailSent===void 0?'<span class="pill pill-mute" title="Worked in the admin inbox \u2014 no notification email is sent for this source">admin only</span>':e.spam?'<span class="pill pill-mute">held</span>':'<span class="pill pill-warn">failed</span>'}static who(e){if(e.name)return`<strong>${n(e.name)}</strong>${e.company?`<div class="muted small">${n(e.company)}</div>`:""}`;if(e.website){let t=e.website.replace(/^https?:\/\//i,"").replace(/^www\./i,"");return`<strong>${n(t.split("/")[0])}</strong>`}return'<span class="muted">\u2014</span>'}static detail(e){let t=[];e.brief&&t.push(`<p class="lead-msg" title="${n(e.brief)}">${n(e.brief)}</p>`),e.website&&t.push(`<p class="lead-detail"><span class="lead-detail-k">Site</span> <a class="url" href="${n(e.website)}" target="_blank" rel="noopener noreferrer">${n(e.website)}</a>${e.sourceUrl?` <span class="lead-detail-k">Read on</span> <a class="url" href="${n(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${n(e.sourceUrl)}</a>`:""}</p>`),t.push(a.why(e));let s=t.join("");return s.trim()?s:""}table(e){let t=this.tab==="spam",s=8;return`<div class="table-scroll"><table class="grid-table leads-table">
      <thead><tr><th>When (ET)</th><th>Name</th><th>Email</th><th>Source</th><th>Service</th><th>Slot</th><th>Email</th><th>${t?"Actions":"Status"}</th></tr></thead>
      ${e.map(i=>{let o=a.detail(i);return`<tbody class="lead-group${i.spam?" is-promo":""}">
        <tr>
          <td class="muted small nowrap">${n(P(i.createdAt))}<div class="lead-time">${n(U(i.createdAt))}</div></td>
          <td>${a.who(i)}${a.categoryPill(i)}</td>
          <td><a class="url" href="mailto:${n(i.email)}">${n(i.email)}</a></td>
          <td>${a.sourcePill(i)}</td>
          <td>${n(ie[i.service]||i.service||"\u2014")}</td>
          <td class="small nowrap">${n(i.timeSlot||"\u2014")}</td>
          <td>${a.emailPill(i)}</td>
          <td>
            ${t?"":O({id:i._id,value:i.status||"new",cls:"cdrop-sm",ariaLabel:"Lead status",options:se.map(l=>({value:l,label:ae(l)}))})}
            <button type="button" class="lead-promo-btn" data-spam="${n(i._id)}" data-to="${i.spam?"false":"true"}">${i.spam?"Not spam":"Mark as spam"}</button>
            ${t?`<button type="button" class="lead-promo-btn is-danger" data-del="${n(i._id)}">Delete</button>`:""}
          </td>
        </tr>${o?`<tr class="lead-msg-row"><td colspan="${s}">${o}</td></tr>`:""}
      </tbody>`}).join("")}
      </table></div>`}blockedTable(e){return`<div class="table-scroll"><table class="grid-table leads-table">
      <thead><tr><th>When (ET)</th><th>Name</th><th>Email</th><th>Source</th><th>Why it was blocked</th></tr></thead>
      ${e.map(t=>{let s=t.brief?`<p class="lead-msg" title="${n(t.brief)}">${n(t.brief)}</p>`:t.website?`<p class="lead-detail"><span class="lead-detail-k">Site</span> ${n(t.website)}</p>`:"";return`<tbody class="lead-group is-promo">
        <tr>
          <td class="muted small nowrap">${n(P(t.createdAt))}<div class="lead-time">${n(U(t.createdAt))}</div></td>
          <td>${a.who(t)}${a.categoryPill(t)}</td>
          <td class="small">${n(t.email)}</td>
          <td>${a.sourcePill(t)}</td>
          <td class="small">${n((t.spamReasons||[]).join(" \xB7 "))} <span class="muted">(${n(String(t.spamScore??"\u2014"))})</span></td>
        </tr>${s?`<tr class="lead-msg-row"><td colspan="5">${s}</td></tr>`:""}
      </tbody>`}).join("")}
      </table></div>`}redraw(){this.render(),this.wire()}wire(){this.root.querySelectorAll("[data-tab]").forEach(e=>{e.addEventListener("click",()=>{this.tab=e.dataset.tab,this.source="all",this.redraw()})}),this.root.querySelectorAll("[data-src]").forEach(e=>{e.addEventListener("click",()=>{this.source=e.dataset.src,this.redraw()})}),B(this.root,async(e,t)=>{try{await c.patchLead({id:e,status:t}),r("Status updated.")}catch(s){r(s.message,"err")}}),this.root.querySelectorAll("[data-spam]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.spam,s=e.dataset.to==="true";try{await c.patchLead({id:t,spam:s,spamCategory:s?"manual":void 0});let i=this._all.find(o=>o._id===t);i&&(i.spam=s,i.spamCategory=s?"manual":null,s||(i.spamReasons=[],i.spamScore=null)),r(s?"Moved to spam.":"Moved back to the inbox."),this.redraw()}catch(i){r(i.message,"err")}})}),this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{let t=e.dataset.del;if(confirm("Delete this submission permanently?"))try{await c.deleteLeads({ids:[t]}),this._all=this._all.filter(s=>s._id!==t),r("Deleted."),this.redraw()}catch(s){r(s.message,"err")}})}),this.root.querySelector("#purge")?.addEventListener("click",async()=>{let e=this.counts().spam;if(confirm(`Permanently delete all ${e} spam submission${e===1?"":"s"}? This cannot be undone.`))try{let t=await c.deleteLeads({purge:"spam"});this._all=this._all.filter(s=>!s.spam),r(`Deleted ${t.deleted} submission${t.deleted===1?"":"s"}.`),this.redraw()}catch(t){r(t.message,"err")}}),this.root.querySelector("#csv")?.addEventListener("click",()=>this.exportCsv())}exportCsv(){let e=this._all||[],t=["createdAt","source","name","email","website","sourceUrl","company","role","service","timeSlot","status","emailSent","spam","spamCategory","spamScore","brief"],s=[t.join(",")].concat(e.map(l=>t.map(d=>{let u=d==="spam"?l.spam?"yes":"no":l[d];return`"${String(u??"").replace(/"/g,'""')}"`}).join(","))).join(`
`),i=new Blob([s],{type:"text/csv"}),o=document.createElement("a");o.href=URL.createObjectURL(i),o.download="davnoot-leads.csv",o.click(),URL.revokeObjectURL(o.href)}};var C=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>',await this.load()}async load(){let e;try{e=await c.listRedirects()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load redirects</h2><p class="muted">${n(t.message)}</p></div>`;return}this.render(e.redirects),this.wire()}render(e){this.root.innerHTML=`
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
          <td class="url">${n(t.source)}</td>
          <td class="url">${t.status===410?'<span class="pill pill-muted">gone</span>':n(t.destination)}</td>
          <td><span class="pill pill-muted">${t.status}</span></td>
          <td class="cell-count">${t.hits||0}</td>
          <td><button class="btn btn-ghost btn-sm" data-del="${n(t.source)}">Delete</button></td>
        </tr>`).join("")}
      </tbody></table></div>`}wire(){this.root.querySelector("#add")?.addEventListener("click",async()=>{let e=this.root.querySelector("#src").value.trim(),t=this.root.querySelector("#dst").value.trim(),s=Number(this.root.querySelector("#code").value);try{await c.createRedirect({source:e,destination:t,status:s}),r("Redirect added."),this.load()}catch(i){r(i.fields?.source||i.fields?.destination||i.message,"err")}}),this.root.querySelectorAll("[data-del]").forEach(e=>{e.addEventListener("click",async()=>{if(await h(`Delete the redirect from ${e.dataset.del}?`,{confirmLabel:"Delete",danger:!0}))try{await c.deleteRedirect(e.dataset.del),r("Deleted."),this.load()}catch(t){r(t.message,"err")}})})}};var A=class{constructor(e){this.root=e}async mount(){this.root.innerHTML='<div class="loading">Loading\u2026</div>';let e;try{e=await c.getSettings()}catch(t){this.root.innerHTML=`<div class="empty"><h2>Couldn't load settings</h2><p class="muted">${n(t.message)}</p></div>`;return}this.eff=e.effective,this.render(e.effective),this.wire()}render(e){this.root.innerHTML=`
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
    `}wire(){this.root.querySelector("#save")?.addEventListener("click",async()=>{let e={};this.root.querySelectorAll("[data-key]").forEach(t=>{oe(e,t.dataset.key,t.value)});try{await c.saveSettings(e),r("Settings saved.")}catch(t){r(t.message,"err")}})}};function m(a,e,t,s){let i=s?`<textarea class="input" rows="3" data-key="${a}">${n(t||"")}</textarea>`:`<input class="input" data-key="${a}" value="${n(t||"")}" />`;return`<div class="field"><label>${n(e)}</label>${i}</div>`}function oe(a,e,t){let s=e.split("."),i=a;for(let o=0;o<s.length-1;o++)(!i[s[o]]||typeof i[s[o]]!="object")&&(i[s[o]]={}),i=i[s[o]];i[s[s.length-1]]=t}var R=class{constructor(e){this.root=e}async mount(){this.root.innerHTML=`
      <div class="empty">
        <h2>Page not found</h2>
        <p class="muted">Nothing lives at <code>${n(location.pathname)}</code>.</p>
        <p><a class="btn btn-dark" href="/admin">Back to overview</a></p>
      </div>`}};var v=D("#app"),$=null;function le(){let a=location.pathname.replace(/^\/admin\/?/,"").split("/").filter(Boolean);if(!a.length)return{view:"overview"};switch(a[0]){case"pages":return a[1]?{view:"page-editor",key:decodeURIComponent(a.slice(1).join("/"))}:{view:"pages"};case"new":return{view:"page-editor",key:"new"};case"seo":return{view:"seo"};case"leads":return{view:"leads"};case"redirects":return{view:"redirects"};case"settings":return{view:"settings"};default:return{view:"404"}}}var G={overview:()=>new S(v),pages:()=>new L(v),"page-editor":a=>new E(v,{key:a.key}),seo:()=>new x(v),leads:()=>new T(v),redirects:()=>new C(v),settings:()=>new A(v),404:()=>new R(v)};async function I(){$?.destroy?.();let a=le();$=(G[a.view]||G[404])(a),re(a.view);try{await $.mount()}catch(e){v.innerHTML=`<div class="empty"><h2>Something went wrong</h2><p>${de(e.message)}</p></div>`}}function re(a){for(let e of document.querySelectorAll(".admin-nav a[data-view]"))e.classList.toggle("active",e.dataset.view===a||a==="page-editor"&&e.dataset.view==="pages")}function de(a){let e=document.createElement("div");return e.textContent=String(a??""),e.innerHTML}document.addEventListener("click",async a=>{let e=a.target.closest("a");if(!e)return;let t=e.getAttribute("href");!t?.startsWith("/admin")||e.target==="_blank"||(a.preventDefault(),!($?.autosave?.hasUnsavedChanges?.()&&!await h("You have unsaved changes. Leave anyway?",{confirmLabel:"Leave",danger:!0}))&&(history.pushState({},"",t),I()))});window.addEventListener("popstate",I);D("#logout")?.addEventListener("click",async()=>{$?.autosave?.hasUnsavedChanges?.()&&!await h("You have unsaved changes. Sign out anyway?",{confirmLabel:"Sign out",danger:!0})||(await c.logout(),location.href="/seoteam/login")});I();})();
