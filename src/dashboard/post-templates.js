/* Starter templates for the editor.
 *
 * These exist so a non-technical writer never faces an empty box. Picking one
 * drops in a real heading skeleton — H2s in a sensible order, with prompts inside
 * them — so the author is filling in a structure rather than inventing one.
 *
 * They are tailored to DAVNOOT's niche, not generic blog templates. The set is
 * drawn from the content backlog in _ai_context/seo-audit-changes.md: the
 * glossary/definition template exists because the GEO cluster needs
 * definition-first pages that answer engines can quote; the comparison template
 * exists because "GEO vs SEO" is an open keyword window; the case-study template
 * exists because the audit flagged that every result on the site is anonymised
 * and E-E-A-T is suffering for it.
 *
 * Adding one is a two-line change: append an entry here. The editor picks it up.
 */

export const TEMPLATES = [
  {
    id: 'how-to',
    label: 'How-To Guide',
    description: 'Step-by-step. Ranks for "how to X" and gets quoted by AI answers.',
    html: `<h2>What you'll need</h2>
<p>List the prerequisites — tools, access, budget, time.</p>
<h2>Step 1 — [First action]</h2>
<p>Open with the outcome of this step, then the instructions.</p>
<h2>Step 2 — [Second action]</h2>
<p></p>
<h2>Step 3 — [Third action]</h2>
<p></p>
<h2>Common mistakes</h2>
<ul><li>Mistake one — and what to do instead.</li><li>Mistake two.</li></ul>
<h2>FAQ</h2>
<h3>[Question people actually search for]</h3>
<p>Answer in the first sentence. Elaborate after.</p>`,
  },

  {
    id: 'glossary',
    label: 'Definition / Glossary',
    description: 'Answer-engine first. Built to be the quoted source in ChatGPT and AI Overviews.',
    html: `<h2>What is [term]?</h2>
<p><strong>[Term] is …</strong> — give the complete, standalone definition in ONE sentence. This is the sentence an AI will quote, so it must make sense with zero surrounding context.</p>
<h2>How [term] works</h2>
<p></p>
<h2>[Term] vs [adjacent term]</h2>
<p>Draw the distinction explicitly — this is the comparison people are really searching for.</p>
<h2>Why it matters</h2>
<p></p>
<h2>FAQ</h2>
<h3>[Direct question]</h3>
<p>Direct answer, first sentence.</p>`,
  },

  {
    id: 'comparison',
    label: 'Comparison (X vs Y)',
    description: 'Head-to-head. Captures high-intent "X vs Y" searches.',
    html: `<h2>The short answer</h2>
<p>Say who should pick which, in two sentences, before any detail. Readers who bounce still got their answer — and so did the AI summarising you.</p>
<h2>What is [X]?</h2>
<p></p>
<h2>What is [Y]?</h2>
<p></p>
<h2>Head to head</h2>
<table><thead><tr><th>Criteria</th><th>[X]</th><th>[Y]</th></tr></thead>
<tbody><tr><td>Cost</td><td></td><td></td></tr><tr><td>Speed</td><td></td><td></td></tr><tr><td>Best for</td><td></td><td></td></tr></tbody></table>
<h2>When to choose [X]</h2>
<p></p>
<h2>When to choose [Y]</h2>
<p></p>
<h2>Our take</h2>
<p></p>`,
  },

  {
    id: 'listicle',
    label: 'Listicle (Top N)',
    description: 'Ranked list. Easy to skim, easy to cite.',
    html: `<h2>The list at a glance</h2>
<ul><li><strong>Best overall:</strong> [pick]</li><li><strong>Best on a budget:</strong> [pick]</li><li><strong>Best for enterprise:</strong> [pick]</li></ul>
<h2>1. [First item]</h2>
<p><strong>Best for:</strong> [who]</p>
<p></p>
<h2>2. [Second item]</h2>
<p></p>
<h2>3. [Third item]</h2>
<p></p>
<h2>How we picked</h2>
<p>Explain the methodology — this is the E-E-A-T signal that separates you from the content farms.</p>`,
  },

  {
    id: 'case-study',
    label: 'Case Study',
    description: 'Named client results. The strongest E-E-A-T asset you can publish.',
    html: `<h2>The result</h2>
<p>Lead with the number. "[Client] grew organic revenue 214% in 7 months."</p>
<h2>The client</h2>
<p>Who they are, what they sell, what market.</p>
<h2>The problem</h2>
<p></p>
<h2>What we did</h2>
<h3>1. [First workstream]</h3>
<p></p>
<h3>2. [Second workstream]</h3>
<p></p>
<h2>The numbers</h2>
<table><thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead>
<tbody><tr><td>Organic sessions</td><td></td><td></td></tr><tr><td>Revenue</td><td></td><td></td></tr></tbody></table>
<h2>What we'd do differently</h2>
<p>Candour here builds more trust than another win claim.</p>`,
  },

  {
    id: 'news',
    label: 'News / Update',
    description: 'Timely take on a platform or algorithm change.',
    html: `<h2>What changed</h2>
<p>The facts, in the first two sentences. No preamble.</p>
<h2>Why it matters</h2>
<p></p>
<h2>What you should do about it</h2>
<ol><li></li><li></li></ol>
<h2>Our read</h2>
<p>The opinion an AI can't generate — this is why anyone reads you and not the press release.</p>`,
  },

  {
    id: 'blank',
    label: 'Blank',
    description: 'Start from nothing.',
    html: '<p></p>',
  },
];

export const findTemplate = (id) => TEMPLATES.find((t) => t.id === id);
