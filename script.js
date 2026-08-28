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
  // Content, not code: read from data-words so the CMS can edit it. Falls back to
  // the original list if the attribute is missing or malformed.
  const DEFAULT_WORDS = ['revenue', 'ROAS', 'growth', 'demand', 'pipeline', 'advantage'];
  let words = DEFAULT_WORDS;
  if (rotEl.dataset.words) {
    try {
      const parsed = JSON.parse(rotEl.dataset.words);
      if (Array.isArray(parsed) && parsed.length) words = parsed;
    } catch { /* keep defaults */ }
  }
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
// Scroll-triggered showcase animations are also gated behind the intro so they
// don't fire invisibly while the intro overlay covers the page.
let _startShowcaseObserving = null;
function startShowcases() { if (_startShowcaseObserving) _startShowcaseObserving(); }
// Hold the page's text animations until the AI-SEO intro finishes; otherwise reveal now.
const introPending = !!document.querySelector('[data-intro]') &&
  !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (!introPending) startReveals();

// === Mobile nav (hamburger) ===
(function () {
  const nav = document.querySelector('nav');
  const toggle = nav && nav.querySelector('.nav-toggle');
  if (!nav || !toggle) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.nav-links a').forEach((a) =>
    a.addEventListener('click', () => {
      nav.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
    })
  );
})();

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

// === ETF LAUNCH → INFLOWS ===
// A fund-launch console builds itself: the ticker types in, the advisor audiences
// populate with reach counting up, compliance scans then clears, and the AUM line
// draws while the net-inflows numbers count up.
async function animEtfShowcase(frame) {
  const queryEl = frame.querySelector('.etf-sc-query');
  const segs = [...frame.querySelectorAll('.etf-sc-seg')];
  const reaches = [...frame.querySelectorAll('.etf-sc-seg-reach')];
  const comp = frame.querySelector('.etf-sc-compliance');
  const compStatus = frame.querySelector('.etf-sc-comp-status');
  const aumVal = frame.querySelector('.etf-sc-aum-val');
  const line = frame.querySelector('.etf-sc-line');
  const flowVals = [...frame.querySelectorAll('.etf-sc-flow-v')];

  // Reset for a clean (re)play
  const fund = queryEl ? (queryEl.dataset.q || queryEl.textContent) : '';
  if (queryEl) { queryEl.dataset.q = fund; queryEl.textContent = ''; }
  segs.forEach(s => s.classList.add('anim-hidden'));
  reaches.forEach(r => { r.dataset.target = r.dataset.target || r.textContent.trim(); r.textContent = '0'; });
  if (comp) comp.classList.remove('anim-scan', 'cleared');
  if (compStatus) compStatus.textContent = 'Reviewing';
  if (aumVal) { aumVal.dataset.target = aumVal.dataset.target || aumVal.textContent.trim(); aumVal.textContent = '$0'; }
  flowVals.forEach(v => { v.dataset.target = v.dataset.target || v.textContent.trim(); v.textContent = '0'; });
  if (line) {
    const len = line.getTotalLength();
    line.style.transition = 'none';
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    line.getBoundingClientRect();       // force reflow so the reset "sticks" before we animate
    line.style.transition = '';
  }

  await ShowcaseAnim.delay(250);

  // 1) The fund name types into the console
  if (queryEl) {
    for (let i = 0; i <= fund.length; i++) { queryEl.textContent = fund.slice(0, i); await ShowcaseAnim.delay(34); }
  }
  await ShowcaseAnim.delay(300);

  // 2) Advisor audiences populate, then their reach counts up
  segs.forEach((s, i) => setTimeout(() => s.classList.remove('anim-hidden'), i * 180));
  await ShowcaseAnim.delay(segs.length * 180 + 150);
  reaches.forEach((r, i) => setTimeout(() => {
    const p = scParse(r.dataset.target);
    if (p) ShowcaseAnim.countUp(r, 0, p.value, 900, x => scFormat(p, x));
    else r.textContent = r.dataset.target;
  }, i * 120));
  await ShowcaseAnim.delay(1150);

  // 3) Compliance scans the campaign, then clears it
  if (comp) comp.classList.add('anim-scan');
  await ShowcaseAnim.delay(900);
  if (comp) { comp.classList.remove('anim-scan'); comp.classList.add('cleared'); }
  if (compStatus) compStatus.textContent = 'Cleared';
  await ShowcaseAnim.delay(450);

  // 4) The AUM line draws as the inflows numbers count up
  if (line) line.style.strokeDashoffset = '0';
  if (aumVal) {
    const p = scParse(aumVal.dataset.target);
    if (p) ShowcaseAnim.countUp(aumVal, 0, p.value, 1500, x => scFormat(p, x));
  }
  flowVals.forEach((v, i) => setTimeout(() => {
    const p = scParse(v.dataset.target);
    if (p) ShowcaseAnim.countUp(v, 0, p.value, 1200, x => scFormat(p, x));
    else v.textContent = v.dataset.target;
  }, 300 + i * 150));
  await ShowcaseAnim.delay(1600);
}

// === SHOPIFY REBUILD ===
// A slow storefront rebuilds itself section by section, the build console checks
// off each phase, the metrics climb from their "before" values to "after", then
// the store makes its first sale and the launch verdict locks in.
async function animShopifyShowcase(frame) {
  const q = frame.querySelector('.sc-shop-q');
  const secs = [...frame.querySelectorAll('.sc-shop-sec')];
  const steps = [...frame.querySelectorAll('.sc-shop-step')];
  const metrics = [...frame.querySelectorAll('.sc-shop-metric b')];
  const load = frame.querySelector('.sc-shop-load');
  const cart = frame.querySelector('.sc-shop-cart');
  const toast = frame.querySelector('.sc-shop-toast');
  const verdict = frame.querySelector('.sc-shop-verdict');

  // Reset — the HTML holds the "after" values so no-JS / reduced-motion sees the
  // real result; we stash those, then rewind each field to its "before" state.
  const url = q ? (q.dataset.q || q.textContent) : '';
  if (q) { q.dataset.q = url; q.textContent = ''; }
  secs.forEach(s => { s.classList.add('anim-hidden'); s.classList.remove('anim-build'); });
  steps.forEach(s => s.classList.remove('done'));
  metrics.forEach(m => { m.dataset.to = m.dataset.to || m.textContent.trim(); m.textContent = m.dataset.from || m.dataset.to; });
  if (load) { load.dataset.to = load.dataset.to || load.textContent.trim(); load.textContent = '5.0s'; load.classList.remove('fast'); }
  if (cart) cart.classList.remove('anim-tap');
  if (toast) toast.classList.remove('show');
  if (verdict) verdict.classList.remove('show');

  await ShowcaseAnim.delay(250);

  // 1) The store URL types into the address bar
  if (q) { for (let i = 0; i <= url.length; i++) { q.textContent = url.slice(0, i); await ShowcaseAnim.delay(28); } }
  await ShowcaseAnim.delay(220);

  // 2) The storefront builds itself top to bottom, each section sweeping in
  for (let i = 0; i < secs.length; i++) {
    secs[i].classList.remove('anim-hidden');
    secs[i].classList.add('anim-build');
    await ShowcaseAnim.delay(320);
  }
  await ShowcaseAnim.delay(180);

  // 3) Each build phase checks off, and its paired metric climbs before → after
  for (let i = 0; i < steps.length; i++) {
    steps[i].classList.add('done');
    const m = metrics[i];
    if (m) {
      const from = scParse(m.dataset.from), to = scParse(m.dataset.to);
      if (from && to) ShowcaseAnim.countUp(m, from.value, to.value, 700, x => scFormat(to, x));
      else m.textContent = m.dataset.to;
    }
    if (i === 2 && load) { // "Speed" phase: the page-load badge drops and turns green
      const to = scParse(load.dataset.to);
      if (to) ShowcaseAnim.countUp(load, 5.0, to.value, 700, x => scFormat(to, x));
      load.classList.add('fast');
    }
    await ShowcaseAnim.delay(400);
  }
  await ShowcaseAnim.delay(200);

  // 4) The store makes its first sale — cart taps, the order toast lands, verdict locks in
  if (cart) cart.classList.add('anim-tap');
  await ShowcaseAnim.delay(420);
  if (toast) toast.classList.add('show');
  await ShowcaseAnim.delay(480);
  if (verdict) verdict.classList.add('show');
}

// === KLAVIYO FLOW BUILDER ===
// A Klaviyo flow assembles itself the way it would in the builder: the trigger
// fires, the email sends and lands in the customer's inbox, then the conditional
// split decides — bought already? exit. Still hasn't? switch channel and text
// them. The SMS lands, the order converts, and the attributed revenue counts up.
//
// The split is the beat the whole page is arguing for, so it gets its own pause:
// the branch NOT taken visibly drops away before the SMS node appears.
//
// As with the Shopify runner, the HTML holds the FINISHED state (real metrics,
// both messages, the taken branch) so no-JS and reduced-motion visitors still see
// the result; this function rewinds it and plays it forward.
async function animKlaviyoShowcase(frame) {
  const nameEl = frame.querySelector('.sc-kl-name');
  const live = frame.querySelector('.sc-kl-live');
  const trigger = frame.querySelector('.sc-kl-node.trigger');
  const emailNode = frame.querySelector('.sc-kl-node.email');
  const smsNode = frame.querySelector('.sc-kl-node.sms');
  const convert = frame.querySelector('.sc-kl-node.convert');
  const split = frame.querySelector('.sc-kl-split');
  const conns = [...frame.querySelectorAll('.sc-kl-conn')];
  const branchYes = frame.querySelector('.sc-kl-branch.yes');
  const branchNo = frame.querySelector('.sc-kl-branch.no');
  const metrics = [...frame.querySelectorAll('.sc-kl-m')];
  const mail = frame.querySelector('.sc-kl-mail');
  const sms = frame.querySelector('.sc-kl-sms');
  const revNum = frame.querySelector('.sc-kl-rev-num');

  // Reset — rewind every finished value back to its starting state
  const flowName = nameEl ? (nameEl.dataset.q || nameEl.textContent) : '';
  if (nameEl) { nameEl.dataset.q = flowName; nameEl.textContent = ''; }
  if (live) live.classList.add('off');
  [trigger, emailNode, smsNode, convert, split, ...conns].forEach(el => el && el.classList.add('anim-hidden'));
  if (convert) convert.classList.remove('anim-glow');
  if (split) split.classList.remove('anim-scan');
  [branchYes, branchNo].forEach(b => b && b.classList.remove('taken', 'dropped'));
  [mail, sms].forEach(el => el && el.classList.add('anim-hidden'));
  metrics.forEach(m => { m.dataset.target = m.dataset.target || m.textContent.trim(); m.textContent = '—'; });
  if (revNum) { revNum.dataset.to = revNum.dataset.to || revNum.textContent.replace(/\D/g, ''); revNum.textContent = '0'; }

  // Beat timings are tuned to land the whole sequence at ~5.3s: the intro
  // takeover races this runner against a 6s watchdog, so anything longer gets
  // its verdict cut off. The other service showcases run ~4.5s.
  await ShowcaseAnim.delay(200);

  // 1) The flow opens in the builder
  if (nameEl) {
    for (let i = 0; i <= flowName.length; i++) { nameEl.textContent = flowName.slice(0, i); await ShowcaseAnim.delay(22); }
  }
  if (live) live.classList.remove('off');
  await ShowcaseAnim.delay(180);

  // 2) Trigger fires, the wait runs, the email sends
  const land = async (el, ms = 260) => { if (el) el.classList.remove('anim-hidden'); await ShowcaseAnim.delay(ms); };
  await land(trigger, 280);
  await land(conns[0], 200);
  await land(emailNode, 260);

  // 3) ...and arrives in the customer's inbox
  if (mail) mail.classList.remove('anim-hidden');
  await ShowcaseAnim.delay(340);

  // 4) The conditional split evaluates: no order yet, so the Yes branch falls away
  await land(conns[1], 190);
  await land(split, 220);
  if (split) split.classList.add('anim-scan');
  await ShowcaseAnim.delay(500);
  if (split) split.classList.remove('anim-scan');
  if (branchYes) branchYes.classList.add('dropped');
  if (branchNo) branchNo.classList.add('taken');
  await ShowcaseAnim.delay(330);

  // 5) Channel switch — the SMS sends and lands under the email
  await land(conns[2], 180);
  if (smsNode) smsNode.classList.remove('anim-hidden');
  if (sms) sms.classList.remove('anim-hidden');
  await ShowcaseAnim.delay(380);

  // 6) The order converts
  await land(conns[3], 170);
  await land(convert, 240);

  // 7) Every metric and the attributed revenue count up together
  metrics.forEach((m, i) => setTimeout(() => {
    const p = scParse(m.dataset.target);
    if (p) ShowcaseAnim.countUp(m, 0, p.value, 900, x => scFormat(p, x));
    else m.textContent = m.dataset.target;
  }, i * 110));
  if (revNum) {
    // Counted by hand rather than through scParse: "47,308" would be read as 47.308.
    const to = parseInt(revNum.dataset.to, 10);
    if (to) ShowcaseAnim.countUp(revNum, 0, to, 1200, x => Math.round(x).toLocaleString('en-US'));
  }
  await ShowcaseAnim.delay(950);

  if (convert) convert.classList.add('anim-glow');
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
  shopify: animShopifyShowcase,
  etf: animEtfShowcase,
  klaviyo: animKlaviyoShowcase,
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
      startShowcases();                      // ...and scroll-triggered showcases can arm now

    }, 1050);
  };
  overlay.addEventListener('click', end);

  // The page starts hidden: styles.css sets `.reveal { opacity: 0 }`, and ONLY
  // end() -> startReveals() makes it visible. So end() MUST be reached no matter
  // what the showcase runner does. A runner that throws (or hangs) used to leave
  // .intro-lock on <html> forever and every .reveal at opacity:0 — a blank page.
  try {
    await ShowcaseAnim.delay(60);
    overlay.classList.add('show');
    await ShowcaseAnim.delay(420);
    await Promise.race([runner(clone), ShowcaseAnim.delay(6000)]); // watchdog: never hang the page
    await ShowcaseAnim.delay(1000);
  } catch (err) {
    console.error('[intro] showcase runner failed', err);
  } finally {
    end();
  }
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
    // Click to replay (always available)
    s.addEventListener('click', () => {
      delete s.dataset.played;
      const type = s.dataset.showcase;
      const fn = runners[type];
      if (fn) fn(s);
    });
  });

  // Defer the scroll observer until the intro finishes; otherwise it can fire
  // while the section is hidden behind the intro overlay (plays invisibly + marks
  // itself "played"), so the in-page animation never shows.
  _startShowcaseObserving = () => showcases.forEach(s => obs.observe(s));
  if (!introPending) _startShowcaseObserving();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShowcases);
} else {
  initShowcases();
}

// ========================================================================
//  TEXT + BOX REVEAL ANIMATIONS — wired across every page
// ========================================================================

(function () {
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
//  TURNSTILE — shared invisible-CAPTCHA loader
// ========================================================================
// Two forms need it now: the booking form on /book-call and the funnel-teardown
// modal on /blog/*. Both mount the SAME widget from the SAME env-var-driven site
// key, which is the point — turning TURNSTILE_SITE_KEY on in Vercel has to protect
// every door at once, or the one nobody remembered becomes the one bots use.
//
// Everything here fails OPEN. No key, no network, or a blocked Cloudflare and the
// form behaves exactly as it did before; api/*.js is the actual boundary.

// One fetch of /api/form-config per page, shared by every caller.
let _formConfig = null;
function formConfig() {
  if (!_formConfig) {
    _formConfig = fetch('/api/form-config')
      .then((r) => r.json())
      .catch(() => ({}));
  }
  return _formConfig;
}

// One <script> load of Cloudflare's api.js per page, however many widgets mount.
let _turnstileApi = null;
function turnstileApi() {
  if (!_turnstileApi) {
    _turnstileApi = new Promise((resolve, reject) => {
      window.davnootTurnstileInit = () => resolve(window.turnstile);
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=davnootTurnstileInit';
      s.async = true;
      s.defer = true;
      s.onerror = () => reject(new Error('turnstile blocked'));
      document.head.appendChild(s);
    });
  }
  return _turnstileApi;
}

/**
 * Mount a Turnstile widget into `holder`, if one is configured.
 *
 * `attach` puts the holder into the DOM and is called ONLY once a key came back —
 * an empty `.form-row` left in a form would otherwise open a 22px hole in the
 * layout of every visitor's page for a widget that never renders.
 *
 * Returns a handle whose methods are all safe to call when no widget mounted:
 *   ready()  resolves once the first outcome (token, error or timeout) has landed
 *   token()  the freshest token, or '' — cleared when it expires or is spent
 *   reset()  re-run the challenge; tokens are SINGLE-USE, so a retry after a
 *            failed send needs a fresh one or it fails again for a different reason
 */
function mountTurnstile(holder, attach) {
  let widget = null;
  let token = '';
  let first = null;

  const mounted = (async () => {
    try {
      const cfg = await formConfig();
      if (!cfg || !cfg.turnstileSiteKey) return;
      if (attach) attach(holder);

      first = new Promise((settle) => {
        turnstileApi().then((turnstile) => {
          widget = turnstile.render(holder, {
            sitekey: cfg.turnstileSiteKey,
            // Invisible unless Cloudflare decides this visitor needs checking, so
            // the overwhelming majority of real people never see anything.
            appearance: 'interaction-only',
            callback: (t) => { token = t; settle(); },
            // A token lives ~5 minutes. Someone filling in a thoughtful brief can
            // easily outlast that, so re-run rather than submit a stale one and
            // hand them an unexplained failure.
            'expired-callback': () => { token = ''; turnstile.reset(widget); },
            'error-callback': () => { token = ''; settle(); },
            'timeout-callback': () => { token = ''; settle(); },
          });
        }, () => settle());
      });
    } catch (err) {
      /* fail open */
    }
  })();

  return {
    async ready(timeoutMs) {
      await mounted;
      if (!first || token) return;
      await Promise.race([first, new Promise((r) => setTimeout(r, timeoutMs || 15000))]);
    },
    token: () => token,
    reset() {
      if (widget !== null && window.turnstile) {
        token = '';
        window.turnstile.reset(widget);
      }
    },
  };
}

// ========================================================================
//  CUSTOM SELECT — progressive enhancement over the native <select>
// ========================================================================
// The <select> is left in the DOM and merely hidden: it still submits `service`,
// it still holds the translated <option> labels (so /fr needs no extra strings),
// and with JS off the form falls back to it untouched. Labels are read FROM the
// select at runtime, so this never has to know what the options say.

(function () {
  const selects = document.querySelectorAll('.book-form select');
  if (!selects.length) return;

  const drops = [];
  const closeAll = (except) => drops.forEach((d) => { if (d.drop !== except) d.close(false); });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cdrop')) closeAll(null);
  });

  selects.forEach((sel) => {
    const opts = [...sel.options];
    if (!opts.length) return;

    const drop = document.createElement('div');
    drop.className = 'cdrop';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cdrop-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    // Reuse the existing <label for="…"> so the control keeps its accessible name.
    const label = sel.id && document.querySelector(`label[for="${sel.id}"]`);
    if (label) {
      if (!label.id) label.id = `${sel.id}-label`;
      btn.setAttribute('aria-labelledby', label.id);
    }

    const labelSpan = document.createElement('span');
    labelSpan.className = 'cdrop-label';
    btn.appendChild(labelSpan);
    btn.insertAdjacentHTML('beforeend',
      '<svg class="cdrop-caret" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>');

    const menu = document.createElement('ul');
    menu.className = 'cdrop-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    const items = opts.map((o, i) => {
      const li = document.createElement('li');
      li.className = 'cdrop-opt';
      li.setAttribute('role', 'option');
      li.id = `${sel.id || 'cdrop'}-opt-${i}`;
      li.textContent = o.textContent.trim();
      menu.appendChild(li);
      return li;
    });

    drop.append(btn, menu);
    sel.parentNode.insertBefore(drop, sel);
    sel.classList.add('cdrop-native');

    let active = Math.max(0, sel.selectedIndex);

    const paint = () => {
      const i = Math.max(0, sel.selectedIndex);
      labelSpan.textContent = items[i].textContent;
      btn.dataset.placeholder = String(opts[i].value === '');
      items.forEach((li, n) => {
        li.classList.toggle('is-selected', n === i);
        li.setAttribute('aria-selected', n === i ? 'true' : 'false');
      });
    };
    const setActive = (i) => {
      active = (i + items.length) % items.length;
      items.forEach((li, n) => li.classList.toggle('is-active', n === active));
      menu.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    };
    const open = () => {
      closeAll(drop);
      drop.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
      setActive(Math.max(0, sel.selectedIndex));
    };
    const close = (refocus) => {
      drop.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      if (refocus) btn.focus();
    };
    const choose = (i) => {
      if (i !== sel.selectedIndex) {
        sel.selectedIndex = i;
        // Anything listening to the real field (validation, analytics) still hears it.
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        paint();
      }
      close(true);
    };

    btn.addEventListener('click', () => (menu.hidden ? open() : close(false)));
    menu.addEventListener('click', (e) => {
      const li = e.target.closest('.cdrop-opt');
      if (li) choose(items.indexOf(li));
    });
    menu.addEventListener('mousemove', (e) => {
      const li = e.target.closest('.cdrop-opt');
      if (li) setActive(items.indexOf(li));
    });

    // Type-ahead, so the control keeps the one affordance a native select has
    // that arrow keys alone do not replace.
    let typed = '', typedAt = 0;
    drop.addEventListener('keydown', (e) => {
      if (menu.hidden) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
        return;
      }
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); setActive(active + 1); return;
        case 'ArrowUp': e.preventDefault(); setActive(active - 1); return;
        case 'Home': e.preventDefault(); setActive(0); return;
        case 'End': e.preventDefault(); setActive(items.length - 1); return;
        case 'Enter': case ' ': e.preventDefault(); choose(active); return;
        case 'Escape': e.preventDefault(); close(true); return;
        case 'Tab': close(false); return;
      }
      if (e.key.length === 1) {
        const now = Date.now();
        typed = now - typedAt > 700 ? e.key : typed + e.key;
        typedAt = now;
        const hit = items.findIndex((li) => li.textContent.toLowerCase().startsWith(typed.toLowerCase()));
        if (hit >= 0) setActive(hit);
      }
    });

    // A hint that only appears for the option it belongs to — permanent helper
    // text would be clutter for the majority who pick a listed service.
    const hint = sel.parentNode.querySelector('[data-hint-for]');
    if (hint) {
      const syncHint = () => { hint.hidden = sel.value !== hint.dataset.hintFor; };
      sel.addEventListener('change', syncHint);
      syncHint();
    }

    drops.push({ drop, close });
    paint();
  });
})();

// ========================================================================
//  BOOK A CALL — form interactions
// ========================================================================

(function () {
  /* Rotating quotes in the reply-promise card.
   *
   * The markup ships all five <figure>s with the first one .is-active, so the
   * card reads correctly with JS off or still loading — this only advances what
   * is already there. Pauses while the tab is hidden so a backgrounded page is
   * not burning a timer, and while the pointer is over the card so a quote
   * someone is mid-way through reading does not slide out from under them. */
  const rail = document.querySelector('[data-quote-rotator]');
  if (!rail) return;
  const quotes = [...rail.querySelectorAll('.reply-quote')];
  if (quotes.length < 2) return;

  const HOLD = 6000;
  let i = 0;
  let timer = null;
  let paused = false;

  function show(next) {
    quotes[i].classList.remove('is-active');
    quotes[i].setAttribute('aria-hidden', 'true');
    i = next;
    quotes[i].classList.add('is-active');
    quotes[i].removeAttribute('aria-hidden');
  }

  function tick() { if (!paused) show((i + 1) % quotes.length); }
  function start() { stop(); timer = setInterval(tick, HOLD); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  rail.addEventListener('mouseenter', () => { paused = true; });
  rail.addEventListener('mouseleave', () => { paused = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  start();
})();

(function () {
  // Form submit — POST the lead to /api/book-call, then reveal confirmation
  const form = document.querySelector('form.book-form');
  if (form) {
    // ── Anti-spam: proof this form was rendered by a browser ────────────────
    // The server scores a submission that arrives without this stamp, and one
    // that arrives implausibly soon after it. A bot POSTing straight at
    // /api/book-call has neither. Recorded here, at wire-up time, so the elapsed
    // value measures how long the form was actually open.
    const openedAt = Date.now();

    // ── Anti-spam: Cloudflare Turnstile, injected only if a key is configured ─
    // The widget is added by script rather than shipped in book-call.html on
    // purpose — that page is golden-tested byte-for-byte and mirrored into
    // French, so its markup is expensive to change, while an env var is free.
    // See api/form-config.js and mountTurnstile() above.
    const turnstileHolder = document.createElement('div');
    turnstileHolder.className = 'form-row turnstile-row';
    const captcha = mountTurnstile(turnstileHolder, (holder) => {
      const note = form.querySelector('.form-note');
      if (note) note.parentNode.insertBefore(holder, note);
      else form.appendChild(holder);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]') || form.querySelector('button');
      const success = document.querySelector('.form-success');
      const original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.t0 = openedAt;
        // Wait for a token only when a widget was actually mounted, and only if
        // we don't already hold a fresh one.
        await captcha.ready();
        if (captcha.token()) data['cf-turnstile-response'] = captcha.token();
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
        if (btn) { btn.innerHTML = 'Sent ✓'; btn.disabled = true; }
      } catch (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        // Turnstile tokens are single-use, so a retry after a failed send needs a
        // fresh one or it would fail again for a completely different reason.
        captcha.reset();
        alert('Sorry — something went wrong sending your request. Please email info@davnoot.com directly.');
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

// === SERVICES PAGE — Contents scrollspy + smooth-scroll ===
// Lives here (not inline on services.html) so it runs under the site CSP
// (script-src 'self'; no 'unsafe-inline'). Guards on .svc-idx-item, so it is a
// no-op on every other page. Vanilla, defensive, prefers-reduced-motion aware.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var navPad = 100;

  var tocRows = Array.prototype.slice.call(document.querySelectorAll('.svc-idx-item'));
  if (!tocRows.length) return;

  // Map each contents link to its target row (#svc-0x).
  var pairs = [];
  tocRows.forEach(function (link) {
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) !== '#') return;
    var target = document.getElementById(href.slice(1));
    if (target) pairs.push({ link: link, target: target });
  });

  // 1) Smooth-scroll with a nav offset (native anchor jump would sit under the fixed nav).
  pairs.forEach(function (p) {
    p.link.addEventListener('click', function (e) {
      e.preventDefault();
      var y = p.target.getBoundingClientRect().top + window.pageYOffset - navPad;
      window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  // 2) Scrollspy — highlight the contents row for whichever service is in view.
  if ('IntersectionObserver' in window) {
    var setActive = function (id) {
      pairs.forEach(function (p) {
        p.link.classList.toggle('is-active', p.target.id === id);
      });
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    pairs.forEach(function (p) { io.observe(p.target); });
  }
})();

// ========================================================================
//  LEAD MAGNET MODAL — the funnel-teardown offer, /blog/* only
// ========================================================================
//
// WHAT IT DOES
// ------------
// On blog pages only, once every 14 days at most, offer a free 15-minute funnel
// teardown in exchange for an email and a website. Posts to /api/funnel-teardown,
// which files it in the same /admin leads inbox as the booking form.
//
// WHEN IT FIRES — whichever comes first:
//   desktop   exit intent (cursor leaves through the top of the viewport)
//   mobile    25 seconds of dwell, because there IS no exit intent on a phone:
//             a coarse pointer never crosses the top edge, and the usual
//             substitute — "detect a fast upward scroll" — fires on people who
//             are simply reading back over a paragraph.
//   both      60% scroll depth
//
// WHERE IT NEVER FIRES
//   anywhere outside /blog, and never on /book-call — someone already filling in
//   the booking form does not need interrupting with a smaller offer. That path is
//   excluded explicitly rather than relying on it not matching /blog, so the rule
//   survives the blog ever gaining a /blog/book-call page.
//
// The markup is built here rather than shipped in lib/blog-render.js so that the
// visits which never see it pay nothing for it, and so a copy change is one file
// rather than a re-render of every post.

(function () {
  const PATH = location.pathname.replace(/\/+$/, '') || '/';
  const ON_BLOG = /^\/blog(\/|$)/.test(PATH);
  const EXCLUDED = /^\/book-call(\/|$)/.test(PATH);
  if (!ON_BLOG || EXCLUDED) return;

  const KEY = 'davnoot:teardown';
  const DAY = 24 * 60 * 60 * 1000;
  const COOLDOWN_MS = 14 * DAY;   // "max once per 14 days"
  const CONVERTED_MS = 365 * DAY; // someone who gave us their email is not asked again
  const MOBILE_DWELL_MS = 25000;  // the exit-intent substitute on touch devices
  const SCROLL_TRIGGER = 0.6;     // 60% of the scrollable distance
  const ARM_DELAY_MS = 3000;      // let the reader land before anything is armed

  /* Frequency capping lives in localStorage, NOT a cookie: it is a UX preference,
   * never leaves the browser, and nothing on the server reads it. A visitor with
   * storage disabled (private mode, some lockdowns) simply sees it once per page
   * load, which is the correct failure direction for a thing that must not nag. */
  function readState() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (err) { return {}; }
  }
  function writeState(patch) {
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign(readState(), patch))); } catch (err) { /* ignore */ }
  }

  const saved = readState();
  const now = Date.now();
  if (saved.convertedAt && now - saved.convertedAt < CONVERTED_MS) return;
  if (saved.shownAt && now - saved.shownAt < COOLDOWN_MS) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Touch-first devices get the dwell timer instead of exit intent. Testing the
   * POINTER rather than the viewport width is what lets a small laptop window still
   * get exit intent, and a large tablet still get the timer. */
  const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  let modal = null;
  let opened = false;
  let lastFocused = null;
  const timers = [];
  const listeners = [];

  /* ---------------------------------------------------------------- markup -- */

  function build() {
    const el = document.createElement('div');
    el.className = 'teardown-modal';
    el.innerHTML = [
      '<div class="teardown-backdrop" data-close></div>',
      '<div class="teardown-panel" role="dialog" aria-modal="true"',
      '     aria-labelledby="teardown-title" aria-describedby="teardown-sub">',
      '  <button type="button" class="teardown-close" data-close aria-label="Close">&times;</button>',
      '  <p class="teardown-eyebrow">Free teardown</p>',
      '  <h2 class="teardown-title" id="teardown-title">Free 15-min funnel <em>teardown</em></h2>',
      '  <p class="teardown-sub" id="teardown-sub">We’ll find where your ad spend is leaking — the ad, the click, the landing page, the form.</p>',
      '  <form class="teardown-form" novalidate>',
      '    <div class="teardown-field">',
      '      <label for="teardown-email">Work email</label>',
      '      <input type="email" id="teardown-email" name="email" autocomplete="email" placeholder="you@company.com" required />',
      '    </div>',
      '    <div class="teardown-field">',
      '      <label for="teardown-website">Website</label>',
      '      <input type="text" id="teardown-website" name="website" autocomplete="url" inputmode="url" placeholder="acme.com" required />',
      '    </div>',
      '    <input type="text" name="bot-field" class="teardown-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />',
      '    <div class="teardown-turnstile"></div>',
      '    <p class="teardown-error" role="alert"></p>',
      '    <button type="submit" class="teardown-submit">Get my teardown <span class="arrow">&rarr;</span></button>',
      '    <p class="teardown-note">No pitch, just the audit.</p>',
      '  </form>',
      '  <div class="teardown-success" role="status" tabindex="-1">',
      '    <h3>On its way.</h3>',
      '    <p>We’ll go through your funnel and email you what we find within one business day. No pitch — just the audit.</p>',
      '  </div>',
      '</div>',
    ].join('\n');
    return el;
  }

  /* ------------------------------------------------------------- open/close -- */

  function close(reason) {
    if (!modal) return;
    const dying = modal;
    modal = null;
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.classList.remove('teardown-open');
    dying.classList.remove('is-open');
    if (reduce) dying.remove();
    else setTimeout(function () { dying.remove(); }, 220);
    // Returning focus to whatever the reader was on is the difference between a
    // modal and a trap for anyone navigating by keyboard.
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    if (reason === 'dismiss') writeState({ dismissedAt: Date.now() });
  }

  function onKeydown(e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); close('dismiss'); return; }
    if (e.key !== 'Tab') return;

    /* Focus trap. Recomputed on every keypress rather than cached, because the
     * panel's contents change: on success the form is replaced by the confirmation,
     * and a cached list would keep tabbing into inputs that are no longer visible. */
    const focusable = focusables();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function focusables() {
    if (!modal) return [];
    return Array.prototype.filter.call(
      modal.querySelectorAll('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), a[href]'),
      function (el) { return el.offsetParent !== null; },
    );
  }

  function open() {
    if (opened) return;
    opened = true;
    disarm();

    /* Stamped BEFORE the modal is shown, so a reader who closes it immediately
     * still counts as having seen it. Re-offering tomorrow because they dismissed
     * it is exactly the behaviour that makes people hate these. */
    writeState({ shownAt: Date.now() });

    lastFocused = document.activeElement;
    modal = build();
    document.body.appendChild(modal);
    document.documentElement.classList.add('teardown-open');
    // One frame before .is-open so the entry transition actually runs.
    requestAnimationFrame(function () { if (modal) modal.classList.add('is-open'); });

    Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'), function (el) {
      el.addEventListener('click', function () { close('dismiss'); });
    });
    document.addEventListener('keydown', onKeydown, true);
    modal.querySelector('#teardown-email').focus({ preventScroll: true });

    wireForm(modal.querySelector('.teardown-form'));
  }

  /* ------------------------------------------------------------------ form -- */

  function wireForm(form) {
    /* t0 measures from the modal APPEARING, not from page load — the server scores
     * an implausibly fast fill, and timing from page load would make every
     * submission look slow however it arrived. See dwellFrom() in lib/lead-intake.js. */
    const openedAt = Date.now();
    const errorEl = form.querySelector('.teardown-error');
    const btn = form.querySelector('.teardown-submit');
    const captcha = mountTurnstile(form.querySelector('.teardown-turnstile'), function (holder) {
      holder.classList.add('is-live');
    });

    function fail(msg, field) {
      errorEl.textContent = msg;
      form.classList.add('has-error');
      const input = field && form.querySelector('[name="' + field + '"]');
      if (input) { input.classList.add('is-invalid'); input.focus(); }
    }

    form.addEventListener('input', function () {
      form.classList.remove('has-error');
      errorEl.textContent = '';
      Array.prototype.forEach.call(form.querySelectorAll('.is-invalid'), function (i) {
        i.classList.remove('is-invalid');
      });
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = form.email.value.trim();
      const website = form.website.value.trim();

      /* Validated here as well as on the server so a typo is corrected in place,
       * rather than answered with a cheerful confirmation for a teardown the
       * reader will then wait on forever. */
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail('That email address looks incomplete.', 'email'); return; }
      if (!/^[^\s/]+\.[a-z]{2,}/i.test(website.replace(/^https?:\/\//i, ''))) {
        fail('Add your website, e.g. acme.com.', 'website');
        return;
      }

      const original = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await captcha.ready();
        const payload = {
          email: email,
          website: website,
          'bot-field': form['bot-field'].value,
          t0: openedAt,
          // Which article they were reading — the most useful single piece of
          // context for whoever writes the teardown, and free to collect.
          sourceUrl: location.pathname,
        };
        if (captcha.token()) payload['cf-turnstile-response'] = captcha.token();

        const res = await fetch('/api/funnel-teardown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          const err = new Error(data.error || 'send failed');
          err.field = data.field;
          err.shown = Boolean(data.error);
          throw err;
        }

        // Converted: suppressed for a year, not fourteen days.
        writeState({ convertedAt: Date.now() });
        if (!modal) return;
        modal.querySelector('.teardown-panel').classList.add('is-done');
        modal.querySelector('.teardown-success').focus({ preventScroll: true });
        timers.push(setTimeout(function () { close('converted'); }, 5000));
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = original;
        // Turnstile tokens are single-use, so a retry needs a fresh one.
        captcha.reset();
        fail(err.shown ? err.message : 'Couldn’t send that — please try again, or email info@davnoot.com.', err.field);
      }
    });
  }

  /* -------------------------------------------------------------- triggers -- */

  function disarm() {
    timers.forEach(clearTimeout);
    timers.length = 0;
    listeners.forEach(function (off) { off(); });
    listeners.length = 0;
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push(function () { target.removeEventListener(type, fn, opts); });
  }

  function arm() {
    /* 60% scroll — on both device classes. `scrollHeight - innerHeight` is the
     * distance that can actually be travelled; on a post shorter than the viewport
     * that is 0, and 0/0 must not read as "already past 60%". */
    on(window, 'scroll', function () {
      const travel = document.documentElement.scrollHeight - window.innerHeight;
      if (travel > 0 && window.scrollY / travel >= SCROLL_TRIGGER) open();
    }, { passive: true });

    if (coarse) {
      timers.push(setTimeout(open, MOBILE_DWELL_MS));
      return;
    }

    /* Exit intent: the cursor leaves through the TOP of the viewport (toward the
     * tabs, the address bar, the close button). relatedTarget is null only when the
     * pointer left the document entirely — without that check this fires every time
     * the cursor crosses an iframe or an open select. */
    on(document, 'mouseout', function (e) {
      if (e.clientY <= 0 && !e.relatedTarget) open();
    });
  }

  timers.push(setTimeout(arm, ARM_DELAY_MS));
})();
