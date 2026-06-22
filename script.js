// ========================================================================
//  DAVNOOT — Shared interactions
// ========================================================================

// === CUSTOM CURSOR ===
const cursor = document.querySelector('.cursor');
const ring = document.querySelector('.cursor-ring');
let mx = 0, my = 0, rx = 0, ry = 0;

if (cursor && ring) {
  document.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    cursor.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
  });

  function animateRing() {
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    requestAnimationFrame(animateRing);
  }
  animateRing();

  document.querySelectorAll('[data-cursor], a, button').forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursor.classList.add('is-hovering');
      ring.classList.add('is-hovering');
    });
    el.addEventListener('mouseleave', () => {
      cursor.classList.remove('is-hovering');
      ring.classList.remove('is-hovering');
    });
  });
}

// === WORD ROTATOR (homepage only) ===
// The 3D growth scene lives in index.html (module). Here we just cycle the headline word.
(function () {
  const rotEl = document.getElementById('rotator');
  if (!rotEl) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const words = ['revenue', 'ROAS', 'growth', 'demand', 'pipeline', 'advantage'];
  let i = 0;
  setInterval(() => {
    rotEl.classList.add('out');
    setTimeout(() => {
      i = (i + 1) % words.length;
      rotEl.textContent = words[i];
      rotEl.classList.remove('out');
    }, 450);
  }, 2600);
})();

// === REVEAL ON SCROLL ===
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1, rootMargin: '0px 0px -80px 0px' });
function startReveals() { document.querySelectorAll('.reveal').forEach(el => io.observe(el)); }
// Hold the page's text animations until the AI-SEO intro finishes; otherwise reveal now.
const introPending = !!document.querySelector('[data-intro]') &&
  !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (!introPending) startReveals();

// === AMBIENT FLOATING DOTS ===
const cvs = document.getElementById('ambient');
if (cvs) {
  const ctx = cvs.getContext('2d');
  let dots = [];
  let W, H;

  function resize() {
    W = cvs.width = window.innerWidth * devicePixelRatio;
    H = cvs.height = window.innerHeight * devicePixelRatio;
    cvs.style.width = window.innerWidth + 'px';
    cvs.style.height = window.innerHeight + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  const COUNT = window.innerWidth < 768 ? 18 : 40;
  for (let i = 0; i < COUNT; i++) {
    dots.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.15 * devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.15 * devicePixelRatio,
      r: (Math.random() * 1.2 + 0.4) * devicePixelRatio
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 10, 10, 0.12)';
    dots.forEach(d => {
      d.x += d.vx; d.y += d.vy;
      if (d.x < 0 || d.x > W) d.vx *= -1;
      if (d.y < 0 || d.y > H) d.vy *= -1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// === HORIZONTAL PROCESS SCROLL (homepage only) ===
const wrap = document.getElementById('process');
const track = document.getElementById('processTrack');
const bar = document.getElementById('processBar');

if (wrap && track) {
  function updateProcess() {
    const rect = wrap.getBoundingClientRect();
    const total = wrap.offsetHeight - window.innerHeight;
    if (rect.top > 0 || rect.bottom < window.innerHeight) {
      if (rect.top > 0) track.style.transform = 'translateX(0)';
      return;
    }
    const scrolled = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolled / total));
    const maxMove = track.scrollWidth - window.innerWidth;
    track.style.transform = `translateX(${-progress * maxMove}px)`;
    if (bar) bar.style.width = (progress * 100) + '%';
  }
  window.addEventListener('scroll', updateProcess, { passive: true });
  window.addEventListener('resize', updateProcess);
  updateProcess();
}

// === FAQ ACCORDION ===
document.querySelectorAll('.faq-item').forEach(item => {
  item.addEventListener('click', () => {
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

// === TOUCH FALLBACK FOR SERVICE CARDS ===
if ('ontouchstart' in window) {
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // only intercept on the card, not on links inside
      if (e.target.closest('a') && e.target.closest('a') !== card) return;
      const wasActive = card.classList.contains('touch-active');
      document.querySelectorAll('.service-card').forEach(c => c.classList.remove('touch-active'));
      if (!wasActive) card.classList.add('touch-active');
    });
  });
  const s = document.createElement('style');
  s.textContent = `
    .service-card.touch-active { background: var(--bg-elev); }
    .service-card.touch-active .service-num { color: var(--accent); }
    .services-grid:has(.touch-active) .service-card:not(.touch-active) { opacity: 0.35; }
  `;
  document.head.appendChild(s);
}

// ========================================================================
//  SHOWCASE ANIMATIONS — recursive proof
// ========================================================================

const ShowcaseAnim = {
  easeOut: t => 1 - Math.pow(1 - t, 3),

  countUp(el, from, to, dur, fmt) {
    fmt = fmt || (v => Math.round(v));
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = ShowcaseAnim.easeOut(t);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  // Typewriter that preserves HTML tags (e.g. <strong>, syntax spans).
  // Builds the DOM incrementally — only ever APPENDS one character to a text
  // node, never rebuilds innerHTML — so there's no re-parse/repaint flicker.
  type(el, html, speed = 15) {
    return new Promise((resolve) => {
      el.innerHTML = '';
      el.classList.add('anim-typing');

      // Parse the target HTML once into a detached tree.
      const tpl = document.createElement('div');
      tpl.innerHTML = html;

      // Flatten that tree into ops in document order.
      const ops = [];
      (function walk(node) {
        node.childNodes.forEach((child) => {
          if (child.nodeType === 3) {            // text
            ops.push({ t: 'text', v: child.nodeValue });
          } else if (child.nodeType === 1) {     // element
            ops.push({ t: 'enter', el: child });
            walk(child);
            ops.push({ t: 'exit' });
          }
        });
      })(tpl);

      const stack = [el];
      const cur = () => stack[stack.length - 1];
      let i = 0;

      const next = () => {
        if (i >= ops.length) {
          el.classList.remove('anim-typing');
          resolve();
          return;
        }
        const op = ops[i++];
        if (op.t === 'enter') {
          const clone = op.el.cloneNode(false);  // tag + attributes, no children
          cur().appendChild(clone);
          stack.push(clone);
          next();                                 // structural — no delay
        } else if (op.t === 'exit') {
          stack.pop();
          next();
        } else {
          // Reveal this text node one character at a time by appending to it.
          const tn = document.createTextNode('');
          cur().appendChild(tn);
          const text = op.v;
          let ci = 0;
          const typeChar = () => {
            if (ci >= text.length) { next(); return; }
            tn.nodeValue += text[ci++];
            setTimeout(typeChar, speed);
          };
          typeChar();
        }
      };
      next();
    });
  },

  delay: (ms) => new Promise(r => setTimeout(r, ms)),
};

// Parse "+612%", "$847K", "5.4×", "12%", "180+", "$0.42"
function scParse(str) {
  if (typeof str !== 'string') return null;
  str = str.trim();
  const m = str.match(/^([+\-$]*)(\d+(?:[.,]\d+)?)([%×K+]?.*)$/);
  if (!m) return null;
  return {
    prefix: m[1],
    value: parseFloat(m[2].replace(',', '.')),
    suffix: m[3],
    hasDecimal: m[2].includes('.') || m[2].includes(',')
  };
}

function scFormat(parsed, value) {
  let v;
  if (parsed.hasDecimal) {
    v = value.toFixed(1);
  } else {
    v = Math.round(value).toString();
  }
  return parsed.prefix + v + parsed.suffix;
}

// === SEO RANK CLIMB (Google organic SERP + rank tracker) ===
async function animSeoShowcase(frame) {
  const queryEl = frame.querySelector('.serp-query');
  const list = frame.querySelector('.serp-org-list');
  const orgs = [...frame.querySelectorAll('.serp-org')];
  const ours = frame.querySelector('.serp-org.ours');
  const others = orgs.filter(o => o !== ours);
  const panel = frame.querySelector('.sc-rank-panel');
  const posEl = frame.querySelector('.rank-pos');
  const kws = [...frame.querySelectorAll('.rank-kw')];

  // Reset
  orgs.forEach(o => { o.classList.add('anim-hidden'); o.style.transition = ''; o.style.transform = ''; });
  if (ours) ours.classList.remove('ranked', 'anim-glow', 'climbing');
  if (panel) panel.classList.remove('anim-draw');
  kws.forEach(k => k.classList.add('anim-hidden'));
  if (posEl) posEl.textContent = '38';
  const full = queryEl ? (queryEl.dataset.q || queryEl.textContent) : '';
  if (queryEl) { queryEl.dataset.q = full; queryEl.textContent = ''; }

  await ShowcaseAnim.delay(250);

  // 1) Type the query
  if (queryEl) {
    for (let i = 0; i <= full.length; i++) { queryEl.textContent = full.slice(0, i); await ShowcaseAnim.delay(34); }
  }
  await ShowcaseAnim.delay(300);

  // 2) Competitor results populate, filling the top slots
  others.forEach((o, i) => setTimeout(() => o.classList.remove('anim-hidden'), i * 130));
  await ShowcaseAnim.delay(others.length * 130 + 400);

  // 3) The client's result physically climbs from #38 (bottom) up to #1 (top),
  //    passing the competitors, while the rank tracker counts 38 → 1.
  const tops = orgs.map(o => o.offsetTop);
  const lastI = orgs.length - 1;
  const ease = 'transform 1.7s cubic-bezier(0.45, 0, 0.15, 1)';

  if (ours) {
    ours.classList.remove('anim-hidden');
    ours.classList.add('climbing');
    ours.style.transition = 'none';
    ours.style.transform = `translateY(${tops[lastI] - tops[0]}px)`; // drop to the bottom slot
  }
  others.forEach(o => {
    const fi = orgs.indexOf(o);
    o.style.transition = 'none';
    o.style.transform = `translateY(${tops[fi - 1] - tops[fi]}px)`; // shift up one slot
  });
  if (list) void list.offsetHeight; // lock the start state before animating

  if (panel) panel.classList.add('anim-draw');
  if (posEl) ShowcaseAnim.countUp(posEl, 38, 1, 1700, v => Math.round(v).toString());
  kws.forEach((k, i) => setTimeout(() => k.classList.remove('anim-hidden'), 600 + i * 170));

  requestAnimationFrame(() => {
    if (ours) { ours.style.transition = ease; ours.style.transform = 'translateY(0)'; }
    others.forEach(o => { o.style.transition = ease; o.style.transform = 'translateY(0)'; });
  });
  await ShowcaseAnim.delay(1850);

  // 4) Verdict — the result locks in at #1
  if (ours) {
    ours.classList.remove('climbing');
    ours.classList.add('ranked', 'anim-glow');
    ours.style.transition = ''; ours.style.transform = '';
  }
  others.forEach(o => { o.style.transition = ''; o.style.transform = ''; });
}

// === META CREATIVE TEST ===
async function animMetaShowcase(frame) {
  const cards = [...frame.querySelectorAll('.sc-creative')];
  const grid = frame.querySelector('.sc-meta-waterfall');
  const winner = frame.querySelector('.sc-creative.winner');
  const budget = frame.querySelector('.sc-meta-budget');

  // Reset to a clean slate so click-to-replay always starts fresh
  cards.forEach(c => {
    c.classList.add('anim-hidden');
    c.classList.remove('anim-dim', 'anim-glow', 'anim-win', 'anim-scan');
  });
  if (budget) budget.classList.remove('anim-show', 'anim-reallocate');
  if (grid) grid.classList.add('anim-judging'); // hide the WINNER pill until the verdict

  // Pre-store stat targets and clear values
  cards.forEach(card => {
    card.querySelectorAll('.sc-stat-row .v').forEach(v => {
      v.dataset.target = v.textContent.trim();
      v.textContent = '—';
    });
  });

  await ShowcaseAnim.delay(250);

  // 1) Cards rise in, one after another
  cards.forEach((c, i) => {
    setTimeout(() => c.classList.remove('anim-hidden'), i * 120);
  });
  await ShowcaseAnim.delay(cards.length * 120 + 350);

  // 2) Each creative's metrics count up
  cards.forEach((card, i) => {
    setTimeout(() => {
      card.querySelectorAll('.sc-stat-row .v').forEach(v => {
        const parsed = scParse(v.dataset.target);
        if (parsed) {
          ShowcaseAnim.countUp(v, 0, parsed.value, 1100, x => scFormat(parsed, x));
        } else {
          v.textContent = v.dataset.target;
        }
      });
    }, i * 90);
  });
  await ShowcaseAnim.delay(1500);

  // 3) Narration beat — "evaluate" each creative, left → right
  for (let i = 0; i < cards.length; i++) {
    cards[i].classList.add('anim-scan');
    await ShowcaseAnim.delay(240);
    cards[i].classList.remove('anim-scan');
  }
  await ShowcaseAnim.delay(150);

  // 4) Verdict — losers fall back, the winner lifts and its pill pops in
  cards.forEach(c => { if (c !== winner) c.classList.add('anim-dim'); });
  await ShowcaseAnim.delay(320);
  if (grid) grid.classList.remove('anim-judging');
  if (winner) winner.classList.add('anim-win', 'anim-glow');

  // 5) Budget reallocation — the platform shifts daily spend to the winner
  if (budget) {
    budget.classList.add('anim-show');
    await ShowcaseAnim.delay(550);
    budget.classList.add('anim-reallocate');
  }
}

// === GOOGLE SEARCH AUCTION ===
async function animGoogleShowcase(frame) {
  const queryEl = frame.querySelector('.serp-query');
  const ads = [...frame.querySelectorAll('.serp-ad')];
  const winner = frame.querySelector('.serp-ad.winner');
  const shopCards = [...frame.querySelectorAll('.shop-card')];
  const shopWinner = frame.querySelector('.shop-card.winner');

  // Reset for a clean (re)play
  ads.forEach(a => {
    a.classList.add('anim-hidden');
    a.classList.remove('anim-dim', 'anim-glow', 'anim-win', 'anim-scan');
    a.querySelectorAll('.serp-m-v').forEach(v => { v.dataset.target = v.textContent.trim(); v.textContent = '—'; });
  });
  shopCards.forEach(c => { c.classList.add('anim-hidden'); c.classList.remove('anim-dim', 'anim-glow'); });
  const full = queryEl ? (queryEl.dataset.q || queryEl.textContent) : '';
  if (queryEl) { queryEl.dataset.q = full; queryEl.textContent = ''; }

  await ShowcaseAnim.delay(250);

  // 1) Type the search query
  if (queryEl) {
    for (let i = 0; i <= full.length; i++) {
      queryEl.textContent = full.slice(0, i);
      await ShowcaseAnim.delay(36);
    }
  }
  await ShowcaseAnim.delay(320);

  // 2) Ad results populate (text ads on the left, Shopping cards on the right)
  ads.forEach((a, i) => setTimeout(() => a.classList.remove('anim-hidden'), i * 160));
  shopCards.forEach((c, i) => setTimeout(() => c.classList.remove('anim-hidden'), 200 + i * 160));
  await ShowcaseAnim.delay(ads.length * 160 + 450);

  // 3) Performance metrics count up
  ads.forEach((ad, i) => setTimeout(() => {
    ad.querySelectorAll('.serp-m-v').forEach(v => {
      const t = v.dataset.target;
      const parsed = t.includes('/') ? null : scParse(t); // leave "9/10" as-is
      if (parsed) ShowcaseAnim.countUp(v, 0, parsed.value, 1000, x => scFormat(parsed, x));
      else v.textContent = t;
    });
  }, i * 110));
  await ShowcaseAnim.delay(1400);

  // 4) The auction evaluates each ad
  for (let i = 0; i < ads.length; i++) {
    ads[i].classList.add('anim-scan');
    await ShowcaseAnim.delay(220);
    ads[i].classList.remove('anim-scan');
  }
  await ShowcaseAnim.delay(150);

  // 5) Verdict — higher Quality Score wins the top slot for less
  ads.forEach(a => { if (a !== winner) a.classList.add('anim-dim'); });
  shopCards.forEach(c => { if (c !== shopWinner) c.classList.add('anim-dim'); });
  await ShowcaseAnim.delay(320);
  if (winner) winner.classList.add('anim-win', 'anim-glow');
  if (shopWinner) shopWinner.classList.add('anim-glow');
}

// === EMAIL FLOW ===
async function animEmailShowcase(frame) {
  const items = [...frame.querySelectorAll('.flow-node, .flow-conn')];
  const metrics = [...frame.querySelectorAll('.flow-metric b')];
  const convert = frame.querySelector('.flow-node.convert');
  const phone = frame.querySelector('.email-phone');
  const erNum = frame.querySelector('.er-num');

  // Reset
  items.forEach(n => n.classList.add('anim-hidden'));
  if (phone) phone.classList.add('anim-hidden');
  if (convert) convert.classList.remove('anim-glow');
  metrics.forEach(m => { m.dataset.target = m.textContent.trim(); m.textContent = '0%'; });
  if (erNum) { erNum.dataset.target = erNum.textContent.trim(); erNum.textContent = '0'; }

  await ShowcaseAnim.delay(250);

  // 1) The automation flow builds itself, top to bottom
  items.forEach((n, i) => setTimeout(() => n.classList.remove('anim-hidden'), i * 130));
  await ShowcaseAnim.delay(items.length * 130 + 200);

  // 2) The first email lands in the inbox preview
  if (phone) phone.classList.remove('anim-hidden');
  await ShowcaseAnim.delay(350);

  // 3) Open rates + revenue per subscriber count up
  metrics.forEach((m, i) => setTimeout(() => {
    const p = scParse(m.dataset.target);
    if (p) ShowcaseAnim.countUp(m, 0, p.value, 900, x => scFormat(p, x));
    else m.textContent = m.dataset.target;
  }, i * 120));
  if (erNum) {
    const p = scParse(erNum.dataset.target);
    if (p) ShowcaseAnim.countUp(erNum, 0, p.value, 1300, x => Math.round(x).toString());
  }
  await ShowcaseAnim.delay(1400);

  // 4) The conversion email lights up
  if (convert) convert.classList.add('anim-glow');
}

// === AI CHAT (AI SEO) — realistic chat streaming an answer that cites the brand ===
async function animChatShowcase(frame) {
  const chats = [...frame.querySelectorAll('.aichat')];

  // Reset each chat: hide, stash + clear its answer, hide typing dots
  chats.forEach(c => {
    c.classList.add('anim-hidden');
    const ans = c.querySelector('.aichat-answer');
    if (ans) { ans.dataset.html = ans.dataset.html || ans.innerHTML; ans.innerHTML = ''; }
    const t = c.querySelector('.aichat-typing');
    if (t) t.style.display = 'none';
  });

  await ShowcaseAnim.delay(250);

  // Each engine reveals, "thinks", then streams its answer (staggered, concurrent)
  const streamOne = async (c, startDelay) => {
    await ShowcaseAnim.delay(startDelay);
    c.classList.remove('anim-hidden');
    const t = c.querySelector('.aichat-typing');
    if (t) t.style.display = 'flex';
    await ShowcaseAnim.delay(700);
    if (t) t.style.display = 'none';
    const ans = c.querySelector('.aichat-answer');
    if (ans) await ShowcaseAnim.type(ans, ans.dataset.html, 10);
  };
  await Promise.all(chats.map((c, i) => streamOne(c, i * 520)));
}

// === AI SEO intro: full-screen takeover on load, then fades into the page ===
const SHOWCASE_RUNNERS = {
  seo: animSeoShowcase,
  meta: animMetaShowcase,
  google: animGoogleShowcase,
  email: animEmailShowcase,
  ai: animChatShowcase,
  'chatgpt-ads': animChatShowcase,
  software: animSoftwareShowcase,
};

// Full-screen intro takeover for any page whose showcase has [data-intro]:
// plays that showcase, then the panel tilts back and falls away in 3D, revealing the page.
async function runIntro() {
  const section = document.querySelector('[data-intro]');
  if (!section) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const frame = section.querySelector('.showcase-frame');
  const runner = frame && SHOWCASE_RUNNERS[frame.dataset.showcase];
  if (!frame || !runner) { startReveals(); return; } // safety: never leave the page hidden

  const overlay = document.createElement('div');
  overlay.className = 'ai-intro-overlay';
  overlay.innerHTML =
    '<div class="ai-intro-panel"><div class="ai-intro-stage"><div class="ai-intro-eyebrow"></div></div></div>' +
    '<button class="ai-intro-skip" type="button">Skip ↓</button>';
  overlay.querySelector('.ai-intro-eyebrow').textContent = section.getAttribute('data-intro') || '';
  const clone = frame.cloneNode(true);
  clone.classList.remove('reveal');  // the frame is a reveal element; keep the clone visible in the intro
  clone.removeAttribute('data-played');
  overlay.querySelector('.ai-intro-stage').appendChild(clone);
  document.body.appendChild(overlay);
  document.documentElement.classList.add('intro-lock');
  window.scrollTo(0, 0);

  let done = false;
  const end = () => {
    if (done) return; done = true;
    overlay.classList.add('out');           // panel tilts back and falls away in 3D
    setTimeout(() => {
      overlay.remove();
      document.documentElement.classList.remove('intro-lock');
      startReveals();                        // intro is gone — NOW the hero/text animations play (and are seen)
    }, 1050);
  };
  overlay.addEventListener('click', end);

  await ShowcaseAnim.delay(60);
  overlay.classList.add('show');
  await ShowcaseAnim.delay(420);
  await runner(clone);
  await ShowcaseAnim.delay(1000);
  end();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runIntro);
} else {
  runIntro();
}

// === AI CITATIONS (used for ChatGPT Ads) ===
async function animAiShowcase(frame) {
  const cards = frame.querySelectorAll('.sc-ai-card');

  // Stash answer HTML, clear, hide
  cards.forEach(c => {
    const a = c.querySelector('.sc-ai-a');
    if (a) { c.dataset.answerHtml = a.innerHTML; a.innerHTML = ''; }
    const r = c.querySelector('.sc-ai-rank');
    if (r) { c.dataset.rankText = r.textContent; r.textContent = '…'; r.style.opacity = '0.4'; }
    c.classList.add('anim-hidden');
  });

  await ShowcaseAnim.delay(250);

  // Reveal + typewrite each card sequentially
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    card.classList.remove('anim-hidden');
    await ShowcaseAnim.delay(180);

    const answerEl = card.querySelector('.sc-ai-a');
    if (answerEl) {
      await ShowcaseAnim.type(answerEl, card.dataset.answerHtml, 13);
    }

    // Reveal rank
    const rankEl = card.querySelector('.sc-ai-rank');
    if (rankEl) {
      rankEl.style.transition = 'opacity 0.5s';
      rankEl.style.opacity = '1';
      rankEl.textContent = card.dataset.rankText;
    }

    await ShowcaseAnim.delay(180);
  }
}

// === SOFTWARE DEPLOY ===
async function animSoftwareShowcase(frame) {
  const files = [...frame.querySelectorAll('.sc-file')];
  const code = frame.querySelector('.sc-code');
  const gutter = frame.querySelector('.sc-gutter');
  const termLines = [...frame.querySelectorAll('.sc-tln')];

  // Reset
  files.forEach(f => f.classList.add('anim-hidden'));
  termLines.forEach(t => t.classList.add('anim-hidden'));
  const codeHtml = code ? (code.dataset.html || code.innerHTML) : '';
  if (code) { code.dataset.html = codeHtml; code.innerHTML = ''; }
  if (gutter) { gutter.style.opacity = '0'; gutter.style.transition = 'opacity 0.4s ease'; }

  await ShowcaseAnim.delay(250);

  // 1) File tree builds in
  files.forEach((f, i) => setTimeout(() => f.classList.remove('anim-hidden'), i * 70));
  await ShowcaseAnim.delay(files.length * 70 + 250);

  // 2) Line numbers fade in, then the code types itself (keeps syntax highlighting)
  if (gutter) gutter.style.opacity = '1';
  if (code) await ShowcaseAnim.type(code, codeHtml, 13);
  await ShowcaseAnim.delay(300);

  // 3) Deploy — terminal lines land one by one
  for (let i = 0; i < termLines.length; i++) {
    termLines[i].classList.remove('anim-hidden');
    await ShowcaseAnim.delay(i === 0 ? 400 : 600);
  }
}

// === INIT + REPLAY ===
function initShowcases() {
  const showcases = document.querySelectorAll('.showcase-frame[data-showcase]');
  if (!showcases.length) return;

  const runners = SHOWCASE_RUNNERS;

  const playOnce = (el) => {
    if (el.dataset.played) return;
    el.dataset.played = '1';
    const type = el.dataset.showcase;
    const fn = runners[type];
    if (fn) fn(el);
  };

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) playOnce(entry.target);
    });
  }, { threshold: 0.25 });

  showcases.forEach(s => {
    obs.observe(s);
    // Click to replay
    s.addEventListener('click', () => {
      delete s.dataset.played;
      const type = s.dataset.showcase;
      const fn = runners[type];
      if (fn) fn(s);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShowcases);
} else {
  initShowcases();
}

// ========================================================================
//  TEXT + BOX REVEAL ANIMATIONS — wired across every page
// ========================================================================

(function() {
  // Selectors for headings that should split into word-spans
  const HEADING_SELECTORS = [
    '.service-hero-title',
    '.section-title',
    '.final-cta-title',
    '.hero-title',
    '.call-hero-title'
  ].join(',');

  // Selectors for elements that fade up (subheads, eyebrows, narrative)
  const FADE_SELECTORS = [
    '.section-eyebrow',
    '.section-sub',
    '.service-hero-sub',
    '.service-num-badge',
    '.final-cta-eyebrow',
    '.final-cta-sub',
    '.case-narrative',
    '.case-meta',
    '.breadcrumb',
    '.call-hero-eyebrow',
    '.call-hero-sub'
  ].join(',');

  // Selectors for boxes that should reveal with stagger
  const BOX_SELECTORS = [
    '.cap-card',
    '.tier-card',
    '.t-card',
    '.tool-chip',
    '.related-card',
    '.approach-step',
    '.faq-item',
    '.deliv-item',
    '.process-card',
    '.work-card',
    '.service-card',
    '.case-spotlight',
    '.case-detail-num',
    '.agenda-card',
    '.next-card',
    '.host-card'
  ].join(',');

  // Split text content of an element into word spans (preserves <em>, <br>, etc.)
  function splitWords(el) {
    if (el.dataset.split) return;
    el.dataset.split = '1';

    const walk = (node) => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === 3) {
          const text = child.textContent;
          if (!text || !text.trim()) return;
          const frag = document.createDocumentFragment();
          const parts = text.split(/(\s+)/);
          parts.forEach(part => {
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
            } else if (part) {
              const span = document.createElement('span');
              span.className = 'split-word';
              span.textContent = part;
              frag.appendChild(span);
            }
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR' && child.tagName !== 'SPAN') {
          walk(child);
        } else if (child.nodeType === 1 && child.tagName === 'EM') {
          // Treat <em> contents as a single split-word but with em styling preserved
          const text = child.textContent;
          if (text && text.trim()) {
            const frag = document.createDocumentFragment();
            text.split(/(\s+)/).forEach(part => {
              if (/^\s+$/.test(part)) {
                frag.appendChild(document.createTextNode(part));
              } else if (part) {
                const inner = document.createElement('span');
                inner.className = 'split-word';
                const emClone = document.createElement('em');
                emClone.textContent = part;
                inner.appendChild(emClone);
                frag.appendChild(inner);
              }
            });
            child.parentNode.replaceChild(frag, child);
          }
        }
      });
    };
    walk(el);
  }

  // Initialize all reveal classes on page elements
  function setupReveals() {
    document.querySelectorAll(HEADING_SELECTORS).forEach(splitWords);
    document.querySelectorAll(FADE_SELECTORS).forEach(el => {
      if (!el.classList.contains('fade-up')) el.classList.add('fade-up');
    });
    document.querySelectorAll(BOX_SELECTORS).forEach(el => {
      if (!el.classList.contains('box-reveal')) el.classList.add('box-reveal');
    });
  }

  // Reveal child elements within a container with stagger
  function revealWithin(container) {
    const words = container.querySelectorAll('.split-word:not(.in)');
    words.forEach((w, i) => {
      setTimeout(() => w.classList.add('in'), i * 38);
    });

    const fades = container.querySelectorAll('.fade-up:not(.in)');
    fades.forEach((f, i) => {
      setTimeout(() => f.classList.add('in'), i * 90 + 60);
    });

    const boxes = container.querySelectorAll('.box-reveal:not(.in)');
    boxes.forEach((b, i) => {
      setTimeout(() => b.classList.add('in'), i * 75 + 140);
    });
  }

  function initRevealObservers() {
    setupReveals();

    const targets = document.querySelectorAll(
      'section, header.service-hero, header.call-hero, .showcase, .hero, .ticker, footer'
    );

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.dataset.revealed) {
          entry.target.dataset.revealed = '1';
          revealWithin(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    targets.forEach(t => obs.observe(t));

    // For above-the-fold content (hero), reveal immediately even if IO is slow
    requestAnimationFrame(() => {
      const hero = document.querySelector('header.service-hero, header.call-hero, .hero');
      if (hero && !hero.dataset.revealed) {
        hero.dataset.revealed = '1';
        revealWithin(hero);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRevealObservers);
  } else {
    initRevealObservers();
  }
})();

// ========================================================================
//  BOOK A CALL — calendar + form interactions
// ========================================================================

(function() {
  // Calendar day selection
  document.addEventListener('click', (e) => {
    const day = e.target.closest('.cal-day');
    if (day) {
      document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('active'));
      day.classList.add('active');
    }
    const slot = e.target.closest('.cal-slot');
    if (slot) {
      document.querySelectorAll('.cal-slot').forEach(s => s.classList.remove('active'));
      slot.classList.add('active');
      // Sync to form hidden input
      const slotInput = document.querySelector('input[name="time_slot"]');
      if (slotInput) slotInput.value = slot.textContent.trim();
    }
  });

  // Form submit — POST the lead to /api/book-call (Resend), then reveal confirmation
  const form = document.querySelector('form.book-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]') || form.querySelector('button');
      const success = document.querySelector('.form-success');
      const original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        const res = await fetch('/api/book-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('send failed');
        [...form.children].forEach((c) => {
          if (!c.classList.contains('form-success')) c.style.display = 'none';
        });
        if (success) success.classList.add('show');
      } catch (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        alert('Sorry — something went wrong sending your request. Please email hello@davnoot.com directly.');
      }
    });
  }
})();

// ========================================================================
//  HERO METRICS — count up on load
// ========================================================================
(function () {
  const nums = document.querySelectorAll('.hero-metric .hm-num');
  if (!nums.length) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Store the target text and blank out the displayed value up front.
  nums.forEach((el) => {
    el.dataset.target = el.textContent.trim();
    const parsed = scParse(el.dataset.target);
    if (parsed && !reduce) el.textContent = scFormat(parsed, 0);
  });

  if (reduce) return; // leave final values in place, no animation

  function run() {
    nums.forEach((el, i) => {
      const parsed = scParse(el.dataset.target);
      if (!parsed) return;
      setTimeout(() => {
        ShowcaseAnim.countUp(el, 0, parsed.value, 1400, (x) => scFormat(parsed, x));
      }, i * 140);
    });
  }

  // Sync with the hero-visual fade-in (animation: fadeUp 1s 1.2s).
  const start = () => setTimeout(run, 1200);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
