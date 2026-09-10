/* Davnoot — free tools: the client-side content-analysis engine.
 *
 * Loaded (minified, as /tools.min.js) by /tools/content-analyzer. It is INERT on
 * every other page: init() bails immediately unless #ca-form exists, so the same
 * file can be added to future tool pages without guarding each one by hand.
 *
 * NOTHING LEAVES THE BROWSER FROM THIS FILE. No fetch, no beacon, no analytics
 * event. The privacy line on the page is a promise this file has to keep, so the
 * only I/O here is the DOM, the clipboard, and localStorage. Keep it that way: if
 * the engine ever needs to talk to a server, that is a different file and a
 * different claim on the page.
 *
 * There IS one upload on this page, and it is not here. Under the report sits an
 * optional card offering a human read of the draft; pressing its button POSTs to
 * /api/content-review. That form is wired in script.js (see TOOL LEAD FORMS),
 * which is where the shared Turnstile loader lives and where a fetch belongs. All
 * this file does is unhide the card once a score exists and hand it the three
 * numbers only the engine knows — see publishToReviewCard().
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL (the five defects of the tool we benchmarked against)
 * ---------------------------------------------------------------------------
 * The reference implementation (heytony.ca/content-analyzer) is a pure client-side
 * Yoast clone. Same shape as this, and it ships five real bugs. Each one is fixed
 * here on purpose, and each fix is commented at its site so nobody "simplifies" it
 * back:
 *
 *   1. It advertises an "SEO score" and never computes an aggregate — the user gets
 *      a list of dots and no number. WE COMPUTE a weighted 0-100 score, normalised
 *      by the weights of the checks that ACTUALLY RAN (see scoreOf()).
 *   2. Its image check matches raw `<img src>` only, so it reports "no images" on
 *      content that plainly has images, and it captures alt text then discards it.
 *      WE DETECT images in HTML *and* Markdown and WE REPORT ALT COVERAGE ("n of m").
 *   3. Its keyword density divides by the count of UNIQUE tokens instead of total
 *      words, so every percentage it prints is wrong (inflated, often 3-5x).
 *      WE DIVIDE BY TOTAL WORDS. Same rule in the word-frequency panel.
 *   4. A hyphenated focus keyword can never match (it de-hyphenates the haystack but
 *      not the needle), and a keyword with regex metacharacters — "c++", "5%", "$1k"
 *      — throws an invalid-RegExp that blanks the results and eats the user's pasted
 *      text. WE NORMALISE BOTH SIDES and WE ESCAPE every user string before it
 *      reaches a RegExp (escapeRegExp / normalizeForMatch), and analyze() is wrapped
 *      in try/catch so a surprise can never destroy the textarea.
 *   5. It ships debug logging in production. This file ships none, deliberately.
 *
 * ---------------------------------------------------------------------------
 * LOCALISATION
 * ---------------------------------------------------------------------------
 * scripts/i18n.js extracts HTML text nodes and the alt/placeholder/aria-label/title
 * attributes — it does NOT read <script> contents. So every string this file renders
 * at runtime lives in STRINGS below, in both locales, selected by <html lang>, which
 * is exactly "fr" on the French twin. Quebec French, with the narrow non-breaking
 * space (\u00A0) before : ; ! ? and %.
 *
 * ---------------------------------------------------------------------------
 * SHAPE
 * ---------------------------------------------------------------------------
 *   1. Locale + strings          2. Text utilities (the RegExp safety layer)
 *   3. Document model            4. Language data (stop words, transitions, verbs)
 *   5. Readability math          6. The checks, by group
 *   7. Scoring                   8. Word frequency
 *   9. DOM layer                10. Boot
 *
 * Sections 2-8 are pure functions over strings and plain objects — no DOM, no state.
 * Only sections 9-10 touch the document. That split is what makes the engine
 * arguable in review and testable later without a headless browser.
 */
(function () {
  'use strict';

  // =========================================================================
  //  1. LOCALE + STRINGS
  // =========================================================================

  /* <html lang> is written by build.js and is exactly "en" or "fr". startsWith is
   * belt-and-braces for a hand-edited "fr-CA" ever appearing. */
  var LANG = /^fr/i.test(document.documentElement.getAttribute('lang') || '') ? 'fr' : 'en';

  var NBSP = '\u00A0'; // French typography: espace insécable before : ; ! ? and %

  /* Every check's copy lives under STRINGS[lang].checks[id] as:
   *   pass / warn / fail / na  -> the FINDING (what is true), used as `label`
   *   detail(p, status)        -> the MEASURED VALUE (numbers, never advice)
   *   fix(p, status)           -> the concrete next action (never rendered on a pass)
   * Keeping the three roles separate is what stops the report reading like a wall of
   * "Good job!" — the detail always carries a number the user can verify by eye. */
  var STRINGS = {
    en: {
      groups: {
        keyword: 'Focus keyword',
        meta: 'Title, meta and slug',
        structure: 'Structure',
        readability: 'Readability',
        links: 'Links and media',
        aeo: 'Answer-engine readiness'
      },
      status: { pass: 'Pass', warn: 'Improve', fail: 'Fix', na: 'Not checked' },
      grades: { excellent: 'Excellent', good: 'Good', work: 'Needs work', poor: 'Poor' },
      bands: {
        veryEasy: 'Very easy', easy: 'Easy', fairlyEasy: 'Fairly easy', standard: 'Standard',
        fairlyDifficult: 'Fairly difficult', difficult: 'Difficult', veryDifficult: 'Very difficult'
      },
      ui: {
        scoreTitle: 'Content score',
        scoreOf: 'out of 100',
        scoreAria: function (p) { return 'Content score ' + p.score + ' out of 100 — ' + p.grade; },
        scoreNote: function (p) {
          return p.ran + ' checks ran on ' + p.words + ' words. Checks that could not run are excluded from the score, not counted as zero.';
        },
        truncatedNote: function (p) {
          return 'That paste was longer than ' + p.max + ' characters. Only the first ' + p.max + ' were analysed.';
        },
        groupScore: function (p) { return p.pct + '%'; },
        freqTitle: 'Word frequency',
        freqNote: 'Percentages are occurrences divided by TOTAL words — the same denominator the density check uses. Common words are removed from the single-word tab only.',
        tab1: '1 word', tab2: '2 words', tab3: '3 words',
        colTerm: 'Term', colCount: 'Count', colShare: 'Share',
        freqEmpty: 'Not enough content yet.',
        copy: 'Copy report', copied: 'Copied', copyFailed: 'Copy failed',
        errorTitle: 'That analysis did not finish',
        errorBody: 'Something in this content tripped the analyzer. Your text is untouched — edit the focus keyword or the content slightly and run it again.',
        aeoNote: 'Answer-engine checks are heuristics for citability. They estimate how liftable a passage is for an AI answer. They are not a ranking guarantee.',
        reportTitle: 'Davnoot content analyzer — report',
        reportScore: function (p) { return 'Score: ' + p.score + '/100 (' + p.grade + ')'; },
        reportKeyword: function (p) { return 'Focus keyword: ' + p.keyword; },
        reportWords: function (p) { return 'Words: ' + p.words + ' · Sentences: ' + p.sentences + ' · Reading ease: ' + p.flesch; },
        reportFix: 'Fix: ',
        reportFooter: 'Generated in the browser at davnoot.com/tools/content-analyzer — nothing was uploaded.'
      },
      checks: {}, // filled in by defineChecks() below
      sample: {
        keyword: 'email marketing automation',
        title: 'Email Marketing Automation: How To Start',
        slug: 'Email_Marketing_Automation_Guide_2026',
        meta: 'A quick look at automating your email.',
        content: [
          '# Email Marketing Automation For Small Teams',
          '',
          'Email marketing automation is the practice of sending the right message on a trigger instead of on a Tuesday, and most teams know they should be doing it, and most of them are still sending everything by hand every single week, which is a slow way to work and a slower way to grow, because the person writing the newsletter is usually the same person answering support tickets and building the landing page, and eventually one of those three jobs gets dropped.',
          '',
          '## Where to start',
          '',
          'Start with a welcome sequence. It is the one flow that runs forever and it is the flow that most brands never finish. Write three emails, space them two days apart, and send them to anyone who subscribes. Our [email marketing service](/email) does this in week one.',
          '',
          '#### Picking a tool',
          '',
          'There are a lot of tools. Some are cheap and some are not. Read a few reviews and pick one you can live with for a couple of years, because migrating later is genuinely painful.',
          '',
          '![](/images/dashboard-screenshot.png)',
          '',
          'You can read more about the channel at https://example.com/email-report and then decide.',
          '',
          'The results were pretty good for us and they will probably be pretty good for you too.'
        ].join('\n')
      }
    },
    fr: {
      groups: {
        keyword: 'Mot-clé principal',
        meta: 'Titre, méta et URL',
        structure: 'Structure',
        readability: 'Lisibilité',
        links: 'Liens et médias',
        aeo: 'Prêt pour les moteurs de réponse'
      },
      status: { pass: 'Réussi', warn: 'À améliorer', fail: 'À corriger', na: 'Non vérifié' },
      grades: { excellent: 'Excellent', good: 'Bon', work: 'À retravailler', poor: 'Faible' },
      bands: {
        veryEasy: 'Très facile', easy: 'Facile', fairlyEasy: 'Assez facile', standard: 'Standard',
        fairlyDifficult: 'Assez difficile', difficult: 'Difficile', veryDifficult: 'Très difficile'
      },
      ui: {
        scoreTitle: 'Score du contenu',
        scoreOf: 'sur 100',
        scoreAria: function (p) { return 'Score du contenu ' + p.score + ' sur 100 —' + NBSP + p.grade; },
        scoreNote: function (p) {
          return p.ran + ' vérifications sur ' + p.words + ' mots. Les vérifications impossibles à faire sont exclues du score, jamais comptées comme un zéro.';
        },
        truncatedNote: function (p) {
          return 'Ce contenu dépasse ' + p.max + ' caractères. Seuls les ' + p.max + ' premiers ont été analysés.';
        },
        groupScore: function (p) { return p.pct + NBSP + '%'; },
        freqTitle: 'Fréquence des mots',
        freqNote: 'Les pourcentages sont les occurrences divisées par le TOTAL des mots — le même dénominateur que la densité. Les mots vides sont retirés de l\u2019onglet à un mot seulement.',
        tab1: '1 mot', tab2: '2 mots', tab3: '3 mots',
        colTerm: 'Terme', colCount: 'Occurrences', colShare: 'Part',
        freqEmpty: 'Pas encore assez de contenu.',
        copy: 'Copier le rapport', copied: 'Copié', copyFailed: 'Échec de la copie',
        errorTitle: 'L\u2019analyse ne s\u2019est pas terminée',
        errorBody: 'Un élément de ce contenu a fait planter l\u2019analyseur. Votre texte est intact\u00A0: modifiez légèrement le mot-clé ou le contenu, puis relancez.',
        aeoNote: 'Ces vérifications sont des heuristiques de citabilité. Elles estiment la facilité avec laquelle un passage peut être repris par une IA. Ce n\u2019est pas une garantie de positionnement.',
        reportTitle: 'Analyseur de contenu Davnoot — rapport',
        reportScore: function (p) { return 'Score' + NBSP + ': ' + p.score + '/100 (' + p.grade + ')'; },
        reportKeyword: function (p) { return 'Mot-clé principal' + NBSP + ': ' + p.keyword; },
        reportWords: function (p) { return 'Mots' + NBSP + ': ' + p.words + ' · Phrases' + NBSP + ': ' + p.sentences + ' · Facilité de lecture' + NBSP + ': ' + p.flesch; },
        reportFix: 'Correctif' + NBSP + ': ',
        reportFooter: 'Généré dans le navigateur sur davnoot.com/fr/tools/content-analyzer — rien n\u2019a été téléversé.'
      },
      checks: {},
      sample: {
        keyword: 'automatisation du marketing courriel',
        title: 'Automatisation du marketing courriel\u00A0: par où commencer',
        slug: 'Automatisation_Marketing_Courriel_Guide_2026',
        meta: 'Un survol rapide de l\u2019automatisation de vos courriels.',
        content: [
          '# Automatisation du marketing courriel pour petites équipes',
          '',
          'L\u2019automatisation du marketing courriel est une façon d\u2019envoyer le bon message sur un déclencheur plutôt qu\u2019un mardi, et la plupart des équipes savent qu\u2019elles devraient le faire, et la plupart le font encore à la main chaque semaine, ce qui est une façon lente de travailler et une façon encore plus lente de croître, parce que la personne qui rédige l\u2019infolettre est souvent la même qui répond au service à la clientèle et qui monte la page d\u2019atterrissage.',
          '',
          '## Par où commencer',
          '',
          'Commencez par une séquence de bienvenue. C\u2019est le seul scénario qui tourne en continu et c\u2019est celui que la plupart des marques ne terminent jamais. Écrivez trois courriels, espacés de deux jours, et envoyez-les à chaque nouvel abonné. Notre [service de marketing courriel](/email) le monte dès la première semaine.',
          '',
          '#### Choisir un outil',
          '',
          'Il existe beaucoup d\u2019outils. Certains sont abordables, d\u2019autres non. Lisez quelques avis et choisissez-en un que vous pourrez garder deux ou trois ans, parce que migrer plus tard fait vraiment mal.',
          '',
          '![](/images/tableau-de-bord.png)',
          '',
          'Vous pouvez lire davantage sur le canal à https://example.com/email-report et décider ensuite.',
          '',
          'Les résultats ont été plutôt bons pour nous et ils seront probablement plutôt bons pour vous aussi.'
        ].join('\n')
      }
    }
  };

  var T = function () { return STRINGS[LANG]; };
  var UI = function () { return STRINGS[LANG].ui; };

  // =========================================================================
  //  2. TEXT UTILITIES — the RegExp safety layer
  // =========================================================================

  /* DEFECT 4, first half. Every user-supplied string that reaches `new RegExp` goes
   * through here first. The reference tool interpolates the raw focus keyword, so
   * "c++" throws SyntaxError: Invalid regular expression, the exception escapes,
   * and the results area is left blank with the user's text apparently "lost". */
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Strip diacritics so "référencement" matches "referencement". */
  function deaccent(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /* DEFECT 4, second half. The reference tool de-hyphenates the CONTENT but not the
   * KEYWORD, so a focus keyword like "e-commerce" or "pay-per-click" can never match
   * anything. Normalisation has to be applied to BOTH sides, identically — which is
   * why every caller runs its haystack through this same function. */
  function normalizeForMatch(s) {
    return deaccent(String(s).toLowerCase())
      .replace(/[\u2018\u2019\u02bc`]/g, "'")   // curly apostrophes -> straight
      .replace(/[\u2013\u2014\-_/\\]+/g, ' ')   // hyphen/underscore/slash == space
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Count phrase occurrences of `needle` in `haystack`, both already normalised. */
  function countPhrase(haystack, needle) {
    if (!needle) return 0;
    // Boundaries are alphanumeric-aware rather than \b, because \b is wrong at the
    // edge of a keyword that ends in punctuation ("c++", "5%").
    var re = new RegExp('(^|[^a-z0-9])' + escapeRegExp(needle) + '(?=[^a-z0-9]|$)', 'g');
    var n = 0;
    while (re.exec(haystack) !== null) {
      n++;
      if (re.lastIndex === 0) break; // paranoia against a zero-width needle
    }
    return n;
  }

  /** Index of the first phrase occurrence, or -1. Both sides pre-normalised. */
  function indexOfPhrase(haystack, needle) {
    if (!needle) return -1;
    var re = new RegExp('(^|[^a-z0-9])(' + escapeRegExp(needle) + ')(?=[^a-z0-9]|$)');
    var m = re.exec(haystack);
    return m ? m.index + m[1].length : -1;
  }

  var ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013',
    mdash: '\u2014', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018',
    ldquo: '\u201c', rdquo: '\u201d', eacute: '\u00e9', egrave: '\u00e8',
    agrave: '\u00e0', ccedil: '\u00e7', laquo: '\u00ab', raquo: '\u00bb'
  };

  /* String.fromCodePoint THROWS a RangeError above U+10FFFF, so a pasted document
   * only had to contain "&#x110000;" — or any truncated/mangled numeric reference —
   * for the exception to escape buildModel and blank the entire report. That is
   * DEFECT 4's failure mode arriving through a second door. An out-of-range or
   * lone-surrogate reference is left as the literal text it already was. */
  function fromCodePointSafe(value, raw) {
    if (!isFinite(value) || value < 0 || value > 0x10ffff) return raw;
    if (value >= 0xd800 && value <= 0xdfff) return raw;
    return String.fromCodePoint(value);
  }

  /** Decode the entities that actually show up in pasted CMS HTML. No DOM parsing:
   *  running user HTML through innerHTML would execute nothing (no insertion) but
   *  would still resolve external references, and we promised zero network I/O. */
  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return fromCodePointSafe(parseInt(h, 16), m); })
      .replace(/&#(\d+);/g, function (m, d) { return fromCodePointSafe(parseInt(d, 10), m); })
      .replace(/&([a-z]+);/gi, function (m, name) {
        var k = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
      });
  }

  /* Script, style and comment spans are cut with indexOf instead of a lazy
   * `[\s\S]*?` pair. When a paste contains many UNCLOSED openers the regex form
   * rescans the whole tail once per opener: 40KB of "<!--" took 0.8s, and the panel
   * re-renders while the user types. This walk is linear and never backtracks. An
   * unclosed opener drops only the opener, never the rest of the user's draft. */
  var SPAN_OPEN = /<!--|<script\b|<style\b/gi;
  function stripSpans(s) {
    SPAN_OPEN.lastIndex = 0;
    var out = '', at = 0, m, lower = null;
    // Once a closer is missing from position p onward it is missing from every later
    // position too, so a document of unclosed openers costs one tail scan, not one
    // per opener.
    var missing = Object.create(null);
    while ((m = SPAN_OPEN.exec(s)) !== null) {
      if (lower === null) lower = s.toLowerCase();
      var open = m[0].toLowerCase();
      var closer = open === '<!--' ? '-->' : (open === '<script' ? '</script>' : '</style>');
      var from = m.index + open.length;
      var end;
      if (missing[closer] !== undefined && from >= missing[closer]) end = -1;
      else {
        end = lower.indexOf(closer, from);
        if (end === -1) missing[closer] = from;
      }
      var stop = end === -1 ? from : end + closer.length;
      out += s.slice(at, m.index) + ' ';
      at = stop;
      SPAN_OPEN.lastIndex = stop;
    }
    return at === 0 ? s : out + s.slice(at);
  }

  /** HTML -> text, preserving paragraph boundaries as blank lines. */
  function htmlToText(html) {
    return stripSpans(String(html))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre|table|ul|ol)>/gi, '\n\n')
      .replace(/<[^>]{1,2000}>/g, ' ');
  }

  /** Markdown -> text. Order matters: images before links, or ![a](b) leaks a "!". */
  function markdownToText(md) {
    return String(md)
      .replace(/```[\s\S]*?```/g, '\n\n')            // fenced code is not prose
      /* Line-leading whitespace is [ \t], never \s. `\s` matches "\n", so on a
       * document with many blank lines `^\s*` swallowed the entire remaining text at
       * every line start and backtracked out of it — 200k characters of blank lines
       * took 23 seconds across these two rules alone. */
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')      // ATX heading markers
      .replace(/^[ \t]{0,3}>[ \t]?/gm, '')           // blockquote markers
      .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, '') // list bullets
      .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '\n')  // horizontal rules
      .replace(/!\[[^\]]{0,300}\]\([^)]{0,500}\)/g, ' ')   // images: alt is scored separately
      .replace(/\[([^\]]{0,300})\]\([^)]{0,500}\)/g, '$1') // links keep their anchor text
      .replace(/^[ \t]*\|.*\|[ \t]*$/gm, function (row) {  // table rows -> their cell text
        return /^[\s|:-]+$/.test(row) ? '' : row.replace(/\|/g, ' ');
      })
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/`([^`]*)`/g, '$1');
  }

  function collapse(s) {
    return String(s).replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Word tokens. Unicode-aware so accented French words are one token, not two. */
  function wordsOf(text) {
    return String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || [];
  }

  /* Sentence splitting is a heuristic and always will be: "Inc." and "e.g." both
   * end a "sentence" here. It is good enough for an average and the readability
   * copy says "estimate" for exactly this reason. */
  function sentencesOf(text) {
    var parts = String(text)
      .replace(/\n+/g, ' ')
      .match(/[^.!?\u2026]+[.!?\u2026]*["'\u2019\u201d)\]]*/g) || [];
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s);
    }
    return out;
  }

  function pct(n, d) { return d > 0 ? (n / d) * 100 : 0; }
  function round1(n) { return Math.round(n * 10) / 10; }

  // =========================================================================
  //  3. DOCUMENT MODEL — parse ONCE, then every check reads this object
  // =========================================================================

  /* One model, built before any check runs. The reference tool re-scans the raw
   * string inside each check with a slightly different regex each time, which is how
   * it ends up reporting "no images" on a document whose images it matched two
   * checks earlier. */

  /* Every wildcard that runs INSIDE a tag or a link is bounded. An unbounded
   * `[^>]*` rescans the rest of the document once per opener when the closing ">"
   * never arrives, and a paste of a few thousand truncated tags then costs tens of
   * seconds — on a panel that re-renders while the user types. Nothing legitimate
   * comes close to these ceilings: a 2000-character attribute list is not a tag and
   * a 300-character anchor is not a link. */
  var HEADING_HTML = /<h([1-6])\b[^>]{0,2000}>([\s\S]{0,4000}?)<\/h\1>/gi;
  var HEADING_MD = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  /* The anchor is matched as a TAG, then its text is taken with indexOf. The
   * one-shot `<a[^>]*?href=(?:"([^"]*)"|…)[^>]*>([\s\S]*?)</a>` form nests three
   * quantifiers, and on a paste with unterminated href quotes it backtracked
   * catastrophically: 9KB of `<a href="` froze for 20 seconds, on every keystroke. */
  var LINK_HTML = /<a\b[^>]{0,2000}>/gi;
  var LINK_MD = /(^|[^!])\[([^\]]{0,300})\]\(\s*<?([^)\s>]{1,500})>?(?:\s+["'][^)]{0,300}["'])?\s*\)/g;
  var IMG_HTML = /<img\b[^>]{0,2000}>/gi;
  var IMG_MD = /!\[([^\]]{0,300})\]\(\s*<?([^)\s>]{1,500})>?(?:\s+["'][^)]{0,300}["'])?\s*\)/g;

  /** Pull one attribute out of a tag string, tolerating attribute order and quoting.
   *  DEFECT 2 lives here: the reference tool's `<img src=...>`-only regex misses
   *  `<img class="x" alt="y" src="z">` and every self-closing variant.
   *  The leading boundary matters as much as the rest: without it `src` matches the
   *  tail of `data-src`, so a lazy-loaded `<img data-src="lazy.png" src="hero.png">`
   *  reported the placeholder as its source and the filename check read the wrong
   *  file. */
  function attrOf(tag, name) {
    var re = new RegExp('(?:^|[\\s"\'/])' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>"\']+))', 'i');
    var m = re.exec(tag);
    if (!m) return null;
    return decodeEntities(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  }

  /* Link kind, not a boolean. "internal" used to mean "anything that is not an
   * absolute http(s) URL somewhere else", which swept up mailto:, tel:, javascript:
   * and bare #fragments — a page whose only two links were a mailto and a phone
   * number passed the internal-link check outright — and it filed protocol-relative
   * //cdn.example.com as internal, when the host after the slashes is the whole
   * point. Fragments and non-http schemes are links a reader can use but not paths
   * a crawler follows to another page, so they count as neither. */
  function linkKind(href) {
    var h = String(href == null ? '' : href).trim();
    if (!h || h.charAt(0) === '#') return 'other';
    if (/^\/\//.test(h)) return /^\/\/(www\.)?davnoot\.com(\/|$)/i.test(h) ? 'internal' : 'external';
    if (/^[a-z][a-z0-9+.\-]*:/i.test(h) && !/^https?:/i.test(h)) return 'other'; // mailto:, tel:, data:, javascript:
    if (!/^https?:\/\//i.test(h)) return 'internal';        // relative path
    return /^https?:\/\/(www\.)?davnoot\.com(\/|$)/i.test(h) ? 'internal' : 'external';
  }

  function isExternal(href) { return linkKind(href) === 'external'; }

  /* Fenced code is not prose, and it was not treated consistently: markdownToText
   * dropped it from the word count while the heading scan still read `# install the
   * deps` inside a ```bash block as an H1 — a document with exactly one real H1
   * failed the one-H1 check with "3 H1 element(s) found". Fences are blanked in a
   * copy that preserves every offset (line lengths are untouched), so heading
   * positions still index into `source`. Linear: no lazy fence-to-fence regex. */
  function maskFencedCode(s) {
    if (s.indexOf('```') === -1 && s.indexOf('~~~') === -1) return s;
    var lines = s.split('\n');
    var open = null;
    for (var i = 0; i < lines.length; i++) {
      var m = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (open === null) {
        if (m) { open = m[1].charAt(0); lines[i] = lines[i].replace(/[^\n]/g, ' '); }
      } else {
        var closes = !!m && m[1].charAt(0) === open;
        lines[i] = lines[i].replace(/[^\n]/g, ' ');
        if (closes) open = null;
      }
    }
    return lines.join('\n');
  }

  /* A hard ceiling on what we will parse. HTML tag scanning is at worst quadratic in
   * the number of malformed tags and the whole panel re-renders while the user
   * types, so an unbounded paste is a frozen tab rather than a slow one. 200k
   * characters is roughly 30k words — far past any page a person is editing — and
   * the truncation is reported on screen rather than hidden. */
  var MAX_SOURCE = 200000;

  function buildModel(raw) {
    var full = String(raw || '');
    var truncated = full.length > MAX_SOURCE;
    var source = truncated ? full.slice(0, MAX_SOURCE) : full;
    /* Every structural scan below reads `scan`, the fence-masked copy, so a code
     * sample can never contribute a heading, a link, an image or a list item. */
    var scan = maskFencedCode(source);

    // ---- headings, in SOURCE ORDER, from both syntaxes -------------------
    var headings = [];
    var m;
    HEADING_HTML.lastIndex = 0;
    while ((m = HEADING_HTML.exec(scan)) !== null) {
      headings.push({
        level: parseInt(m[1], 10),
        text: collapse(decodeEntities(htmlToText(m[2]))),
        start: m.index,
        end: m.index + m[0].length
      });
    }
    HEADING_MD.lastIndex = 0;
    while ((m = HEADING_MD.exec(scan)) !== null) {
      headings.push({
        level: m[1].length,
        text: collapse(markdownToText(m[2])),
        start: m.index,
        end: m.index + m[0].length
      });
    }
    headings.sort(function (a, b) { return a.start - b.start; });

    // ---- links -----------------------------------------------------------
    var links = [];
    var lowerScan = scan.toLowerCase();
    var noCloseAfter = Infinity;   // once "</a>" is gone it stays gone: one tail scan
    LINK_HTML.lastIndex = 0;
    while ((m = LINK_HTML.exec(scan)) !== null) {
      var href = attrOf(m[0], 'href');
      if (href === null) continue;                       // <a name="x"> is not a link
      var close = LINK_HTML.lastIndex >= noCloseAfter ? -1 : lowerScan.indexOf('</a>', LINK_HTML.lastIndex);
      if (close === -1) noCloseAfter = Math.min(noCloseAfter, LINK_HTML.lastIndex);
      var anchor = close === -1 ? '' : scan.slice(LINK_HTML.lastIndex, close);
      links.push({ href: href, text: collapse(htmlToText(anchor)), kind: linkKind(href), external: isExternal(href) });
    }
    LINK_MD.lastIndex = 0;
    while ((m = LINK_MD.exec(scan)) !== null) {
      links.push({ href: m[3], text: collapse(m[2]), kind: linkKind(m[3]), external: isExternal(m[3]) });
      /* The leading "not a !" group CONSUMES a character, so `[a](/1)[b](/2)` lost
       * the second link entirely. Rewind one character — the ")" just matched — so
       * the next link still has a prefix to match against. m[0] is at least five
       * characters, so lastIndex always moves forward. */
      LINK_MD.lastIndex = m.index + m[0].length - 1;
    }

    // ---- images (DEFECT 2: both syntaxes, and we KEEP the alt) -----------
    var images = [];
    IMG_HTML.lastIndex = 0;
    while ((m = IMG_HTML.exec(scan)) !== null) {
      images.push({ src: attrOf(m[0], 'src') || '', alt: attrOf(m[0], 'alt') });
    }
    IMG_MD.lastIndex = 0;
    while ((m = IMG_MD.exec(scan)) !== null) {
      images.push({ src: m[2], alt: m[1] });
    }

    // ---- lists and tables ------------------------------------------------
    var htmlListItems = (scan.match(/<li\b[^>]{0,2000}>/gi) || []).length;
    var mdListItems = (scan.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/gm) || []).length;
    var htmlLists = (scan.match(/<(ul|ol)\b[^>]{0,2000}>/gi) || []).length;
    var htmlTables = (scan.match(/<table\b[^>]{0,2000}>/gi) || []).length;
    var mdTableRows = (scan.match(/^[ \t]*\|.*\|[ \t]*$/gm) || []).length;
    /* The delimiter row ("|---|:--:|"), found with ONE character class and no nested
     * stars. The old `^[ \t]*\|?[ \t:|-]*\|[ \t:|-]*$` put two greedy runs over
     * overlapping classes on the same line, which is quadratic: a single 200k-character
     * line took 100 seconds inside a .test() that was only asking "is there a table". */
    var mdTables = 0;
    var DELIM_ROW = /^[ \t:|-]+$/gm;
    var dm;
    while ((dm = DELIM_ROW.exec(scan)) !== null) {
      if (dm[0].indexOf('|') !== -1 && dm[0].indexOf('-') !== -1) {
        mdTables = mdTableRows >= 2 ? 1 : 0;
        break;
      }
    }

    // ---- plain text ------------------------------------------------------
    var text = collapse(decodeEntities(markdownToText(htmlToText(scan))));
    var words = wordsOf(text);
    var sentences = sentencesOf(text);

    // Paragraphs: blank-line separated. HTML block closers were turned into blank
    // lines by htmlToText, so both syntaxes land here. A document written with
    // single newlines (a plain-text paste) falls back to line-per-paragraph.
    var paragraphs = text.split(/\n\s*\n/).map(collapse).filter(Boolean);
    if (paragraphs.length <= 1) {
      var lines = text.split(/\n/).map(collapse).filter(Boolean);
      if (lines.length > 1) paragraphs = lines;
    }

    // Word runs BETWEEN headings, used for "longest stretch with no subheading".
    var segments = [];
    var cursor = 0;
    for (var i = 0; i < headings.length; i++) {
      segments.push(wordsOf(collapse(markdownToText(htmlToText(scan.slice(cursor, headings[i].start))))).length);
      cursor = headings[i].end;
    }
    segments.push(wordsOf(collapse(markdownToText(htmlToText(scan.slice(cursor))))).length);

    // Bare URLs: markdown/HTML links already had their targets removed by the text
    // pass, so anything http:// still standing in `text` was pasted naked.
    var nakedUrls = text.match(/(?:^|\s)(https?:\/\/[^\s<)]+)/g) || [];

    return {
      source: source,
      truncated: truncated,
      text: text,
      norm: normalizeForMatch(text),
      words: words,
      sentences: sentences,
      paragraphs: paragraphs,
      headings: headings,
      links: links,
      images: images,
      lists: htmlLists + (mdListItems >= 2 ? 1 : 0),
      listItems: htmlListItems + mdListItems,
      tables: htmlTables + mdTables,
      segments: segments,
      nakedUrls: nakedUrls,
      firstWords: normalizeForMatch(words.slice(0, 100).join(' '))
    };
  }

  // =========================================================================
  //  4. LANGUAGE DATA
  // =========================================================================

  var STOP_WORDS = {
    en: ('a about after all also am an and any are as at be because been before being between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with you your').split(' '),
    fr: ('a afin ai ainsi alors au aucun aussi autre aux avec avoir bien car ce cela ces cet cette ceux chaque comme d dans de des du elle elles en encore est et eux fait faire il ils je la le les leur leurs lui ma mais me mes moi mon ne nos notre nous on ou où par pas peu plus pour qu que quel quelle qui sa sans se ses si son sont sur ta te tes toi ton tous tout tres très tu un une vos votre vous y à ça été être').split(' ')
  };

  /* Transition words drive the "does this read as connected argument" check. Both
   * lists are multi-word-safe: matching happens on the normalised sentence, so
   * "en revanche" and "on the other hand" work. */
  var TRANSITIONS = {
    en: ['also', 'and then', 'as a result', 'because', 'besides', 'but', 'consequently', 'even so', 'finally', 'first', 'for example', 'for instance', 'furthermore', 'however', 'in addition', 'in contrast', 'in fact', 'in other words', 'in short', 'instead', 'likewise', 'meanwhile', 'moreover', 'next', 'nevertheless', 'on the other hand', 'otherwise', 'second', 'similarly', 'since', 'so', 'still', 'that is', 'therefore', 'though', 'thus', 'to sum up', 'while', 'yet'],
    fr: ['ainsi', 'alors', 'a l inverse', 'au contraire', 'aussi', 'autrement dit', 'bref', 'car', 'cependant', 'c est pourquoi', 'd abord', 'd ailleurs', 'de plus', 'donc', 'en effet', 'en revanche', 'en resume', 'ensuite', 'enfin', 'par ailleurs', 'par consequent', 'par exemple', 'pourtant', 'puis', 'puisque', 'meme si', 'neanmoins', 'toutefois', 'premierement', 'deuxiemement', 'finalement']
  };

  /* Copula / definition verbs. Used twice: the "is there a direct answer up top"
   * heuristic and the "is there a definition sentence" heuristic. */
  var COPULA = {
    en: ['is', 'are', 'was', 'were', 'means', 'refers to', 'describes', 'involves', 'includes', 'allows', 'helps', 'lets', 'costs', 'takes'],
    fr: ['est', 'sont', 'signifie', 'designe', 'consiste', 'comprend', 'inclut', 'permet', 'aide', 'coute', 'prend']
  };

  var QUESTION_STARTS = {
    en: ['how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'do', 'does', 'is', 'are', 'should', 'will'],
    fr: ['comment', 'pourquoi', 'quoi', 'quand', 'ou', 'qui', 'quel', 'quelle', 'quels', 'quelles', 'combien', 'est ce que', 'faut il', 'peut on']
  };

  // Irregular past participles the "-ed" test cannot see. Passive voice is an
  // ESTIMATE and the copy says so; this list buys most of the accuracy.
  var IRREGULAR_PP = ('been born brought bought built caught chosen done driven eaten fallen felt found given gone grown heard held kept known laid led left lent lost made meant met paid put read run said seen sent set shown sold spent taken taught told thought understood won written').split(' ');

  var BE_VERBS = ['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'get', 'gets', 'got'];
  var BE_VERBS_FR = ['est', 'sont', 'etait', 'etaient', 'ete', 'sera', 'seront', 'soit'];

  // =========================================================================
  //  5. READABILITY MATH
  // =========================================================================

  /* English syllable counter. Vowel groups, minus a silent trailing e, plus the
   * consonant+"le" beat ("ta-ble", "lit-tle"), floor of 1. Flesch is only as good
   * as this function, so it is written out rather than approximated by "count the
   * vowels", which over-counts every "-tion" and "-ea-" in the language. */
  function countSyllables(word) {
    var raw = String(word);
    var w = deaccent(raw.toLowerCase()).replace(/[^a-z]/g, '');
    /* A token of digits ("2026", "45000") has no letters and used to score ZERO
     * syllables, which dragged the average below one syllable per word — arithmetically
     * impossible for anything a person reads aloud — and inflated Flesch on any page
     * carrying figures, which is every page we want people to write. Floor it at one. */
    if (!w) return /[\p{L}\p{N}]/u.test(raw) ? 1 : 0;
    if (w.length <= 3) return 1;
    var consonantLe = /[^aeiou]le$/.test(w);
    // "-ed" is its own beat after t or d (crea-ted, deci-ded) and silent otherwise
    // (walked, used). Stripping it unconditionally scored "created" as one syllable.
    if (/[^td]ed$/.test(w)) w = w.slice(0, -2);
    else if (!/[td]ed$/.test(w)) {
      // "-es" is also its own beat after s, x, z, ch and sh (hous-es, box-es,
      // church-es); everywhere else it is silent (makes, likes).
      if (/(?:[sxz]|ch|sh)es$/.test(w)) w = w.slice(0, -1);
      else w = w.replace(/(?:es|e)$/, '');
    }
    var groups = w.match(/[aeiouy]+/g) || [];
    var n = groups.length + (consonantLe ? 1 : 0);
    return n < 1 ? 1 : n;
  }

  function totalSyllables(words) {
    var n = 0;
    for (var i = 0; i < words.length; i++) n += countSyllables(words[i]);
    return n;
  }

  /** Flesch Reading Ease, spelled out so the constants are auditable. */
  function fleschScore(wordCount, sentenceCount, syllableCount) {
    if (!wordCount || !sentenceCount) return 0;
    return 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / wordCount);
  }

  function fleschBand(score) {
    var b = T().bands;
    if (score >= 90) return b.veryEasy;
    if (score >= 80) return b.easy;
    if (score >= 70) return b.fairlyEasy;
    if (score >= 60) return b.standard;
    if (score >= 50) return b.fairlyDifficult;
    if (score >= 30) return b.difficult;
    return b.veryDifficult;
  }

  /** Passive-voice ESTIMATE: a be-verb followed within two tokens by a participle. */
  function passiveSentences(sentences) {
    var be = LANG === 'fr' ? BE_VERBS_FR : BE_VERBS;
    var hits = 0;
    for (var i = 0; i < sentences.length; i++) {
      var toks = normalizeForMatch(sentences[i]).split(' ');
      for (var j = 0; j < toks.length; j++) {
        if (be.indexOf(toks[j]) === -1) continue;
        for (var k = j + 1; k <= j + 3 && k < toks.length; k++) {
          var t = toks[k];
          var participle = LANG === 'fr'
            ? /(?:e|es|ee|ees|is|it|its|us|ues)$/.test(t) && t.length > 4
            : (/ed$/.test(t) && t.length > 3) || IRREGULAR_PP.indexOf(t) !== -1;
          if (participle) { hits++; j = toks.length; break; }
        }
      }
    }
    return hits;
  }

  function transitionSentences(sentences) {
    var list = TRANSITIONS[LANG];
    var hits = 0;
    for (var i = 0; i < sentences.length; i++) {
      var s = ' ' + normalizeForMatch(sentences[i]) + ' ';
      for (var j = 0; j < list.length; j++) {
        if (s.indexOf(' ' + list[j] + ' ') !== -1) { hits++; break; }
      }
    }
    return hits;
  }

  /* Approximate rendered pixel width of a title in Google's desktop SERP font
   * (~20px Arial). Per-character averages, not metrics — the report always calls it
   * an estimate, because the real width depends on the font Google serves that day. */
  var PX_NARROW = "iljtfrI.,:;'|!\u2019[]() ";
  var PX_WIDE = 'mwMW@%';
  function pixelWidth(str) {
    var s = String(str);
    var total = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (PX_NARROW.indexOf(c) !== -1) total += 5;
      else if (PX_WIDE.indexOf(c) !== -1) total += 17;
      else if (c >= 'A' && c <= 'Z') total += 12.5;
      else if (c >= '0' && c <= '9') total += 10;
      else total += 9.7;
    }
    return Math.round(total);
  }

  // =========================================================================
  //  6. THE CHECKS
  // =========================================================================

  /* WEIGHTS is the audit surface for the score. Every id below appears exactly once
   * here and once in defineChecks(). A check with no weight would silently score 0
   * for everyone, so keep them together. */
  var WEIGHTS = {
    'kw.title': 10, 'kw.meta': 5, 'kw.slug': 5, 'kw.h1': 8, 'kw.intro': 7,
    'kw.subheads': 5, 'kw.density': 8, 'kw.exact': 3,
    'title.length': 7, 'title.pixels': 3, 'meta.length': 6, 'slug.words': 3,
    'slug.separator': 3, 'slug.stopwords': 2, 'slug.format': 3, 'slug.dates': 2,
    'struct.words': 8, 'struct.h1': 6, 'struct.hierarchy': 5, 'struct.gap': 4,
    'struct.paragraphs': 3, 'struct.longpara': 4, 'struct.lists': 3,
    'read.flesch': 6, 'read.sentence': 4, 'read.longsentences': 4,
    'read.passive': 3, 'read.transitions': 3, 'read.syllables': 2,
    'links.total': 4, 'links.internal': 6, 'links.external': 3, 'links.naked': 2,
    'media.images': 4, 'media.alt': 6, 'media.altempty': 2, 'media.altfilename': 2,
    'aeo.answer': 6, 'aeo.questions': 4, 'aeo.liftable': 4, 'aeo.specifics': 4,
    'aeo.parasentences': 3, 'aeo.definition': 3
  };

  /* The check dictionary. Kept out of STRINGS' literal above only to keep that
   * object readable — it is merged in at load. */
  function defineChecks() {
    var n = function (v) { return String(v); };

    STRINGS.en.checks = {
      'kw.title': {
        pass: 'Focus keyword is in the SEO title, near the front',
        warn: 'Focus keyword appears late in the SEO title',
        fail: 'Focus keyword is missing from the SEO title',
        na: 'No SEO title to check',
        detail: function (p, s) {
          if (s === 'na') return 'Add an SEO title to run this check.';
          if (s === 'fail') return 'The title does not contain "' + p.keyword + '".';
          return 'First match starts at character ' + n(p.pos) + ' of ' + n(p.len) + '.';
        },
        fix: function (p, s) {
          return s === 'fail'
            ? 'Rewrite the title so it opens with "' + p.keyword + '".'
            : 'Move "' + p.keyword + '" into the first half of the title — the part that survives truncation.';
        }
      },
      'kw.meta': {
        pass: 'Focus keyword is in the meta description',
        warn: 'Meta description mentions only part of the keyword',
        fail: 'Focus keyword is missing from the meta description',
        na: 'No meta description to check',
        detail: function (p, s) {
          if (s === 'na') return 'Add a meta description to run this check.';
          return n(p.hits) + ' exact match(es) in ' + n(p.len) + ' characters.';
        },
        fix: function () { return 'Work the exact phrase into the description once — Google bolds it in the snippet.'; }
      },
      'kw.slug': {
        pass: 'Focus keyword is in the URL slug',
        warn: 'Slug carries only part of the keyword',
        fail: 'Focus keyword is missing from the URL slug',
        na: 'No slug to check',
        detail: function (p, s) {
          if (s === 'na') return 'Add a URL slug to run this check.';
          return 'Slug: ' + p.slug;
        },
        fix: function (p) { return 'Use a slug built from the keyword, e.g. ' + p.suggestion + '.'; }
      },
      'kw.h1': {
        pass: 'Focus keyword is in the H1',
        warn: 'H1 is close but not an exact match',
        fail: 'Focus keyword is missing from the H1',
        na: 'No H1 found in the content',
        detail: function (p, s) {
          if (s === 'na') return 'The content has no H1, so there is nothing to match against.';
          return 'H1: ' + p.h1;
        },
        fix: function (p, s) {
          return s === 'na' ? 'Add a single H1 that contains the focus keyword.'
            : 'Put "' + p.keyword + '" in the H1, phrased for a reader rather than for a crawler.';
        }
      },
      'kw.intro': {
        pass: 'Focus keyword appears in the first 100 words',
        warn: 'Focus keyword appears late in the opening',
        fail: 'Focus keyword is absent from the first 100 words',
        na: 'Not enough content to check the opening',
        detail: function (p, s) {
          if (s === 'na') return 'Write at least 20 words to run this check.';
          return s === 'fail' ? 'No match in the first 100 words.' : 'First match at word ' + n(p.at) + '.';
        },
        fix: function () { return 'State the subject in the opening sentence, using the exact phrase.'; }
      },
      'kw.subheads': {
        pass: 'Focus keyword appears in your subheadings',
        warn: 'Keyword appears in only one subheading',
        fail: 'No subheading contains the focus keyword',
        na: 'No subheadings found',
        detail: function (p, s) {
          if (s === 'na') return 'Add H2s and H3s so the page has a skimmable spine.';
          return n(p.hits) + ' of ' + n(p.total) + ' subheadings contain it.';
        },
        fix: function () { return 'Work the keyword or a close variant into one or two H2s — not all of them.'; }
      },
      'kw.density': {
        pass: 'Keyword density is in a natural range',
        warn: 'Keyword density is outside the comfortable range',
        fail: 'Keyword density looks like stuffing',
        na: 'Not enough words to measure density',
        detail: function (p, s) {
          if (s === 'na') return 'Density needs at least 50 words.';
          return n(p.hits) + ' occurrences in ' + n(p.words) + ' words = ' + n(p.density) + '% (target 0.5-2.5%).';
        },
        fix: function (p, s) {
          if (s === 'fail') return 'Cut roughly ' + n(p.excess) + ' uses and let synonyms carry the rest.';
          return p.density < 0.5 ? 'Use the phrase a few more times where it reads naturally.'
            : 'Trim a couple of uses; the page already reads as being about this.';
        }
      },
      'kw.exact': {
        pass: 'The exact phrase appears in the body',
        warn: 'The exact phrase appears only once',
        fail: 'The exact phrase never appears in the body',
        na: 'No focus keyword or no content to check',
        detail: function (p, s) {
          if (s === 'na') return 'Enter a focus keyword and paste some content to run this check.';
          return n(p.hits) + ' exact-phrase match(es), matched with hyphens and accents ignored.';
        },
        fix: function () { return 'Use the phrase verbatim at least twice — the intro and one subheading is enough.'; }
      },

      'title.length': {
        pass: 'SEO title length is in range',
        warn: 'SEO title is outside the ideal length',
        fail: 'SEO title length will hurt the snippet',
        na: 'No SEO title supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add an SEO title to run these checks.';
          return n(p.len) + ' characters (ideal 50-60, hard limits 25 and 65).';
        },
        fix: function (p) {
          return p.len < 50 ? 'Add ' + n(50 - p.len) + ' or so characters of real qualifier — city, outcome, or year.'
            : 'Cut about ' + n(p.len - 60) + ' characters so nothing important is truncated.';
        }
      },
      'title.pixels': {
        pass: 'Estimated title width fits the SERP',
        warn: 'Estimated title width is close to truncation',
        fail: 'Estimated title width will be truncated',
        na: 'No SEO title supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add an SEO title to run these checks.';
          return 'About ' + n(p.px) + 'px of a ~580px allowance. This is an estimate from an average-width table, not a font measurement.';
        },
        fix: function () { return 'Front-load the meaning: assume everything past ~580px is invisible.'; }
      },
      'meta.length': {
        pass: 'Meta description length is in range',
        warn: 'Meta description is outside the ideal length',
        fail: 'Meta description length will hurt the snippet',
        na: 'No meta description supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add a meta description to run these checks.';
          return n(p.len) + ' characters (ideal 120-160, hard limits 70 and 165).';
        },
        fix: function (p) {
          return p.len < 120 ? 'Add a benefit and a reason to click; you have about ' + n(155 - p.len) + ' characters spare.'
            : 'Trim about ' + n(p.len - 155) + ' characters so the sentence ends before Google cuts it.';
        }
      },
      'slug.words': {
        pass: 'Slug is short',
        warn: 'Slug is longer than it needs to be',
        fail: 'Slug is far too long',
        na: 'No slug supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add a URL slug to run these checks.';
          return n(p.count) + ' words (aim for 5 or fewer).';
        },
        fix: function () { return 'Drop filler words; keep the nouns that describe the page.'; }
      },
      'slug.separator': {
        pass: 'Slug uses hyphens',
        warn: 'Slug separators are inconsistent',
        fail: 'Slug uses underscores or spaces',
        na: 'No slug supplied',
        detail: function (p, s) { return s === 'na' ? 'Add a URL slug to run these checks.' : 'Slug: ' + p.slug; },
        fix: function () { return 'Use hyphens between words. Google treats an underscore as a joiner, not a separator.'; }
      },
      'slug.stopwords': {
        pass: 'Slug has no filler words',
        warn: 'Slug contains filler words',
        fail: 'Slug is mostly filler words',
        na: 'No slug supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add a URL slug to run these checks.';
          return p.found.length ? 'Found: ' + p.found.join(', ') + '.' : 'No stop words found.';
        },
        fix: function () { return 'Remove the small connecting words — they add length and no meaning.'; }
      },
      'slug.format': {
        pass: 'Slug is lowercase and clean',
        warn: 'Slug has characters that are better removed',
        fail: 'Slug has uppercase or unsafe characters',
        na: 'No slug supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add a URL slug to run these checks.';
          return p.issues.length ? p.issues.join(' ') : 'Lowercase letters, digits and hyphens only.';
        },
        fix: function () { return 'Lowercase everything and strip anything that is not a letter, a digit or a hyphen.'; }
      },
      'slug.dates': {
        pass: 'Slug contains no date',
        warn: 'Slug contains a year',
        fail: 'Slug contains a full date',
        na: 'No slug supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Add a URL slug to run these checks.';
          return s === 'pass' ? 'No year or date fragment found.' : 'Found: ' + p.found + '.';
        },
        fix: function () { return 'Keep the year in the title where you can edit it, not in a URL you would have to redirect.'; }
      },

      'struct.words': {
        pass: 'Word count is competitive',
        warn: 'Word count is thin for a competitive query',
        fail: 'Word count is below the floor',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the structure checks.';
          return n(p.words) + ' words. 300 is the floor; about 900 is where competitive pages start.';
        },
        fix: function (p) {
          var gap = p.words < 300 ? 300 - p.words : 900 - p.words;
          return 'Add roughly ' + n(gap) + ' more words of substance — examples, numbers, a real objection answered.';
        }
      },
      'struct.h1': {
        pass: 'Exactly one H1',
        warn: 'H1 is missing',
        fail: 'More than one H1',
        na: 'No content supplied',
        detail: function (p, s) { return s === 'na' ? 'Paste some content to run the structure checks.' : n(p.count) + ' H1 element(s) found.'; },
        fix: function (p) { return p.count === 0 ? 'Add one H1 that states the page subject.' : 'Demote the extra H1s to H2 — one page, one H1.'; }
      },
      'struct.hierarchy': {
        pass: 'Heading levels are in order',
        warn: 'Headings start below H2',
        fail: 'A heading level is skipped',
        na: 'Not enough headings to check order',
        detail: function (p, s) {
          if (s === 'na') return 'Add subheadings to give the page a spine.';
          return s === 'fail' ? 'Jump found: H' + n(p.from) + ' straight to H' + n(p.to) + '.' : 'Levels used: ' + p.used.join(', ') + '.';
        },
        fix: function () { return 'Step one level at a time. An H2 followed by an H4 tells a parser a section is missing.'; }
      },
      'struct.gap': {
        pass: 'No long stretch without a subheading',
        warn: 'One stretch runs long without a subheading',
        fail: 'A very long stretch has no subheading',
        na: 'Not enough content to check',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the structure checks.';
          return 'Longest run: ' + n(p.longest) + ' words (warn above 300).';
        },
        fix: function () { return 'Break the long run with an H2 or H3 that answers a question a reader would ask there.'; }
      },
      'struct.paragraphs': {
        pass: 'Paragraph count is healthy',
        warn: 'Very few paragraphs',
        fail: 'The content is one block',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the structure checks.';
          return n(p.count) + ' paragraphs, ' + n(p.avg) + ' words each on average.';
        },
        fix: function () { return 'Split on the ideas: one claim per paragraph makes the page skimmable and quotable.'; }
      },
      'struct.longpara': {
        pass: 'No over-long paragraph',
        warn: 'One paragraph is long',
        fail: 'A paragraph is far too long',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the structure checks.';
          return 'Longest paragraph: ' + n(p.longest) + ' words (warn above 150).';
        },
        fix: function () { return 'Cut the longest paragraph in two at its natural turn.'; }
      },
      'struct.lists': {
        pass: 'Content includes a list or a table',
        warn: 'Only one short list',
        fail: 'No list or table',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the structure checks.';
          return n(p.lists) + ' list(s), ' + n(p.items) + ' items, ' + n(p.tables) + ' table(s).';
        },
        fix: function () { return 'Turn one paragraph of enumerated points into a real list — it is the format both readers and models lift.'; }
      },

      'read.flesch': {
        pass: 'Reading ease is comfortable',
        warn: 'Reading ease is demanding',
        fail: 'Reading ease is very demanding',
        na: 'Not enough content to score readability',
        detail: function (p, s) {
          if (s === 'na') return 'Readability needs a few full sentences.';
          return 'Flesch Reading Ease ' + n(p.score) + ' — ' + p.band + '.';
        },
        fix: function () { return 'Shorten sentences and swap long words for short ones. Target 60 or above for a marketing page.'; }
      },
      'read.sentence': {
        pass: 'Average sentence length is fine',
        warn: 'Sentences average long',
        fail: 'Sentences average far too long',
        na: 'Not enough sentences to measure',
        detail: function (p, s) {
          if (s === 'na') return 'Write a few full sentences to measure this.';
          return n(p.avg) + ' words per sentence across ' + n(p.count) + ' sentences (aim for 20 or fewer).';
        },
        fix: function () { return 'Find the longest sentences and cut each one in half at its comma.'; }
      },
      'read.longsentences': {
        pass: 'Few very long sentences',
        warn: 'Many sentences run over 25 words',
        fail: 'Most sentences run over 25 words',
        na: 'Not enough sentences to measure',
        detail: function (p, s) {
          if (s === 'na') return 'Write a few full sentences to measure this.';
          return n(p.count) + ' of ' + n(p.total) + ' sentences are over 25 words = ' + n(p.share) + '% (warn above 25%).';
        },
        fix: function () { return 'Rewrite the worst offenders as two sentences each.'; }
      },
      'read.passive': {
        pass: 'Passive voice is under control',
        warn: 'Passive voice is common',
        fail: 'Passive voice dominates',
        na: 'Not enough sentences to estimate',
        detail: function (p, s) {
          if (s === 'na') return 'Write a few full sentences to measure this.';
          return 'About ' + n(p.share) + '% of sentences look passive (' + n(p.count) + ' of ' + n(p.total) + '). This is a heuristic estimate, not a parse.';
        },
        fix: function () { return 'Name the actor: "we cut spend 30%" beats "spend was cut by 30%".'; }
      },
      'read.transitions': {
        pass: 'Transitions connect the argument',
        warn: 'Few transition words',
        fail: 'Almost no transition words',
        na: 'Not enough sentences to measure',
        detail: function (p, s) {
          if (s === 'na') return 'Write a few full sentences to measure this.';
          return n(p.share) + '% of sentences open with or contain a transition (aim for 30%).';
        },
        fix: function () { return 'Add connectors — "but", "so", "for example" — where one idea answers the last.'; }
      },
      'read.syllables': {
        pass: 'Word length is plain',
        warn: 'Words run long',
        fail: 'Words run very long',
        na: 'Not enough words to measure',
        detail: function (p, s) {
          if (s === 'na') return 'Paste more content to measure this.';
          return n(p.avg) + ' syllables per word on average (plain writing sits near 1.5).';
        },
        fix: function () { return 'Swap the abstract nouns for verbs: "we test" rather than "implementation of testing".'; }
      },

      'links.total': {
        pass: 'The page links out',
        warn: 'Very few links',
        fail: 'No links at all',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the link checks.';
          return n(p.total) + ' link(s): ' + n(p.internal) + ' internal, ' + n(p.external) + ' external.';
        },
        fix: function () { return 'Add links where a reader would want more depth — that is also where a crawler wants them.'; }
      },
      'links.internal': {
        pass: 'Internal links are present',
        warn: 'Only one internal link',
        fail: 'No internal links',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the link checks.';
          return n(p.internal) + ' internal link(s) found. This is the single most common miss on a new page.';
        },
        fix: function () { return 'Link to two or three related pages with descriptive anchor text, not "click here".'; }
      },
      'links.external': {
        pass: 'External sources are cited',
        warn: 'No external sources cited',
        fail: 'No external sources cited',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the link checks.';
          return n(p.external) + ' external link(s) found.';
        },
        fix: function () { return 'Cite the source behind your strongest claim. It is a trust signal for readers and for models.'; }
      },
      'links.naked': {
        pass: 'No bare URLs in the text',
        warn: 'Bare URLs pasted as text',
        fail: 'Several bare URLs pasted as text',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the link checks.';
          return n(p.count) + ' bare URL(s) sitting in the copy.';
        },
        fix: function () { return 'Wrap them in real links with anchor text that says where they go.'; }
      },
      'media.images': {
        pass: 'The content has images',
        warn: 'Only one image',
        fail: 'No images',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run the media checks.';
          return n(p.count) + ' image(s) detected in HTML and Markdown.';
        },
        fix: function () { return 'Add a screenshot, a chart, or a photo of the actual work. One image per 300 words is a fair rhythm.'; }
      },
      'media.alt': {
        pass: 'Every image has alt text',
        warn: 'Some images are missing alt text',
        fail: 'Most images are missing alt text',
        na: 'No images to check',
        detail: function (p, s) {
          if (s === 'na') return 'Alt coverage is only meaningful once there is an image.';
          return n(p.withAlt) + ' of ' + n(p.total) + ' images have alt text.';
        },
        fix: function () { return 'Describe what the image shows, in a sentence a person would say out loud.'; }
      },
      'media.altempty': {
        pass: 'No empty alt attributes',
        warn: 'Some alt attributes are empty',
        fail: 'Several alt attributes are empty',
        na: 'No images to check',
        detail: function (p, s) {
          if (s === 'na') return 'Alt coverage is only meaningful once there is an image.';
          return n(p.count) + ' image(s) carry an empty alt.';
        },
        fix: function () { return 'An empty alt is correct only for purely decorative images. If it carries meaning, describe it.'; }
      },
      'media.altfilename': {
        pass: 'No alt text repeats a filename',
        warn: 'Alt text repeats the filename',
        fail: 'Alt text repeats the filename',
        na: 'No images to check',
        detail: function (p, s) {
          if (s === 'na') return 'Alt coverage is only meaningful once there is an image.';
          return n(p.count) + ' alt value(s) are just the filename.';
        },
        fix: function () { return 'Replace "dashboard-screenshot" with what the screenshot actually shows.'; }
      },

      'aeo.answer': {
        pass: 'A direct answer appears near the top',
        warn: 'The opening is close to a direct answer',
        fail: 'No direct answer in the opening',
        na: 'Not enough content to check',
        detail: function (p, s) {
          if (s === 'na') return 'Write an opening paragraph to run this check.';
          return s === 'pass'
            ? 'Found a ' + n(p.len) + '-word answer sentence in the opening.'
            : 'No sentence of 15-45 words in the opening contains the keyword and a defining verb. Heuristic, not a ranking signal.';
        },
        fix: function () { return 'Open with one self-contained sentence that answers the query in 15-45 words.'; }
      },
      'aeo.questions': {
        pass: 'Subheadings are phrased as questions',
        warn: 'Only one question subheading',
        fail: 'No subheading is phrased as a question',
        na: 'No subheadings found',
        detail: function (p, s) {
          if (s === 'na') return 'Add subheadings to run this check.';
          return n(p.count) + ' of ' + n(p.total) + ' subheadings read as questions.';
        },
        fix: function () { return 'Phrase two subheadings the way a person would type them, then answer each in the first line under it.'; }
      },
      'aeo.liftable': {
        pass: 'There is a list or table a model can lift',
        warn: 'Only a very short list',
        fail: 'Nothing structured to lift',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run this check.';
          return n(p.items) + ' list item(s) and ' + n(p.tables) + ' table(s). Heuristic for citability.';
        },
        fix: function () { return 'Add a short steps-or-criteria list. Structured blocks are what answer engines quote.'; }
      },
      'aeo.specifics': {
        pass: 'The content is specific',
        warn: 'The content is light on specifics',
        fail: 'The content has almost no specifics',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run this check.';
          return n(p.count) + ' concrete details (numbers, percentages, dates, named entities) across ' + n(p.words) + ' words.';
        },
        fix: function () { return 'Replace an adjective with a number. "Fast" is unquotable; "under 200ms" is not.'; }
      },
      'aeo.parasentences': {
        pass: 'Paragraphs are short and self-contained',
        warn: 'Paragraphs run long for citation',
        fail: 'Paragraphs are too long to be lifted',
        na: 'No content supplied',
        detail: function (p, s) {
          if (s === 'na') return 'Paste some content to run this check.';
          return n(p.avg) + ' sentences per paragraph on average. Passages of 2-4 sentences get cited most often — a heuristic, not a rule.';
        },
        fix: function () { return 'Keep each paragraph to one claim plus its evidence.'; }
      },
      'aeo.definition': {
        pass: 'A definition-style sentence is present',
        warn: 'The definition sentence is vague',
        fail: 'No definition-style sentence',
        na: 'Not enough content to check',
        detail: function (p, s) {
          if (s === 'na') return 'Write a few sentences to run this check.';
          return s === 'pass' ? 'Found a sentence of the form "X is a ...".' : 'No "X is a ..." sentence found. Heuristic for citability.';
        },
        fix: function () { return 'Add one plain definition sentence: the subject, "is", and what it is.'; }
      }
    };

    STRINGS.fr.checks = {
      'kw.title': {
        pass: 'Le mot-clé est dans le titre SEO, près du début',
        warn: 'Le mot-clé arrive tard dans le titre SEO',
        fail: 'Le mot-clé est absent du titre SEO',
        na: 'Aucun titre SEO à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez un titre SEO pour lancer cette vérification.';
          if (s === 'fail') return 'Le titre ne contient pas «' + NBSP + p.keyword + NBSP + '».';
          return 'Première occurrence au caractère ' + n(p.pos) + ' sur ' + n(p.len) + '.';
        },
        fix: function (p, s) {
          return s === 'fail'
            ? 'Réécrivez le titre pour qu\u2019il commence par «' + NBSP + p.keyword + NBSP + '».'
            : 'Déplacez «' + NBSP + p.keyword + NBSP + '» dans la première moitié du titre, la partie qui survit à la troncature.';
        }
      },
      'kw.meta': {
        pass: 'Le mot-clé est dans la méta description',
        warn: 'La méta description ne reprend qu\u2019une partie du mot-clé',
        fail: 'Le mot-clé est absent de la méta description',
        na: 'Aucune méta description à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une méta description pour lancer cette vérification.';
          return n(p.hits) + ' correspondance(s) exacte(s) sur ' + n(p.len) + ' caractères.';
        },
        fix: function () { return 'Insérez la phrase exacte une fois\u00A0: Google la met en gras dans l\u2019extrait.'; }
      },
      'kw.slug': {
        pass: 'Le mot-clé est dans l\u2019URL',
        warn: 'L\u2019URL ne reprend qu\u2019une partie du mot-clé',
        fail: 'Le mot-clé est absent de l\u2019URL',
        na: 'Aucune URL à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une URL pour lancer cette vérification.';
          return 'URL' + NBSP + ': ' + p.slug;
        },
        fix: function (p) { return 'Utilisez une URL construite à partir du mot-clé, par exemple ' + p.suggestion + '.'; }
      },
      'kw.h1': {
        pass: 'Le mot-clé est dans le H1',
        warn: 'Le H1 s\u2019en approche sans correspondre exactement',
        fail: 'Le mot-clé est absent du H1',
        na: 'Aucun H1 trouvé dans le contenu',
        detail: function (p, s) {
          if (s === 'na') return 'Le contenu n\u2019a pas de H1\u00A0: rien à comparer.';
          return 'H1' + NBSP + ': ' + p.h1;
        },
        fix: function (p, s) {
          return s === 'na' ? 'Ajoutez un seul H1 contenant le mot-clé principal.'
            : 'Placez «' + NBSP + p.keyword + NBSP + '» dans le H1, formulé pour un lecteur et non pour un robot.';
        }
      },
      'kw.intro': {
        pass: 'Le mot-clé apparaît dans les 100 premiers mots',
        warn: 'Le mot-clé arrive tard dans l\u2019introduction',
        fail: 'Le mot-clé est absent des 100 premiers mots',
        na: 'Contenu insuffisant pour vérifier l\u2019introduction',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez au moins 20 mots pour lancer cette vérification.';
          return s === 'fail' ? 'Aucune occurrence dans les 100 premiers mots.' : 'Première occurrence au mot ' + n(p.at) + '.';
        },
        fix: function () { return 'Annoncez le sujet dès la première phrase, avec la formulation exacte.'; }
      },
      'kw.subheads': {
        pass: 'Le mot-clé apparaît dans vos sous-titres',
        warn: 'Le mot-clé n\u2019apparaît que dans un sous-titre',
        fail: 'Aucun sous-titre ne contient le mot-clé',
        na: 'Aucun sous-titre trouvé',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez des H2 et des H3 pour donner une colonne vertébrale à la page.';
          return n(p.hits) + ' sous-titres sur ' + n(p.total) + ' le contiennent.';
        },
        fix: function () { return 'Intégrez le mot-clé ou une variante dans un ou deux H2, pas dans tous.'; }
      },
      'kw.density': {
        pass: 'La densité du mot-clé est naturelle',
        warn: 'La densité du mot-clé sort de la plage confortable',
        fail: 'La densité du mot-clé ressemble à du bourrage de mots-clés',
        na: 'Trop peu de mots pour mesurer la densité',
        detail: function (p, s) {
          if (s === 'na') return 'La densité exige au moins 50 mots.';
          return n(p.hits) + ' occurrences sur ' + n(p.words) + ' mots = ' + n(p.density) + NBSP + '% (cible 0,5-2,5' + NBSP + '%).';
        },
        fix: function (p, s) {
          if (s === 'fail') return 'Retirez environ ' + n(p.excess) + ' occurrences et laissez les synonymes faire le reste.';
          return p.density < 0.5 ? 'Utilisez la phrase quelques fois de plus, là où cela se lit naturellement.'
            : 'Retirez deux ou trois occurrences\u00A0: le sujet de la page est déjà clair.';
        }
      },
      'kw.exact': {
        pass: 'La phrase exacte apparaît dans le corps',
        warn: 'La phrase exacte n\u2019apparaît qu\u2019une fois',
        fail: 'La phrase exacte n\u2019apparaît jamais',
        na: 'Aucun mot-clé principal ou aucun contenu à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'Entrez un mot-clé principal et collez du contenu pour lancer cette vérification.';
          return n(p.hits) + ' correspondance(s) exacte(s), traits d\u2019union et accents ignorés.';
        },
        fix: function () { return 'Employez la phrase telle quelle au moins deux fois\u00A0: l\u2019introduction et un sous-titre suffisent.'; }
      },

      'title.length': {
        pass: 'La longueur du titre SEO est bonne',
        warn: 'La longueur du titre SEO n\u2019est pas idéale',
        fail: 'La longueur du titre SEO nuira à l\u2019extrait',
        na: 'Aucun titre SEO fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez un titre SEO pour lancer ces vérifications.';
          return n(p.len) + ' caractères (idéal 50-60, limites 25 et 65).';
        },
        fix: function (p) {
          return p.len < 50 ? 'Ajoutez une vingtaine de caractères utiles\u00A0: ville, résultat ou année.'
            : 'Retirez environ ' + n(p.len - 60) + ' caractères pour ne rien perdre à la troncature.';
        }
      },
      'title.pixels': {
        pass: 'La largeur estimée du titre passe',
        warn: 'La largeur estimée du titre frôle la troncature',
        fail: 'La largeur estimée du titre sera tronquée',
        na: 'Aucun titre SEO fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez un titre SEO pour lancer ces vérifications.';
          return 'Environ ' + n(p.px) + 'px sur une allocation d\u2019environ 580px. Estimation issue d\u2019une table de largeurs moyennes, pas d\u2019une mesure de police.';
        },
        fix: function () { return 'Mettez le sens en premier\u00A0: considérez que tout ce qui dépasse ~580px est invisible.'; }
      },
      'meta.length': {
        pass: 'La longueur de la méta description est bonne',
        warn: 'La longueur de la méta description n\u2019est pas idéale',
        fail: 'La longueur de la méta description nuira à l\u2019extrait',
        na: 'Aucune méta description fournie',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une méta description pour lancer ces vérifications.';
          return n(p.len) + ' caractères (idéal 120-160, limites 70 et 165).';
        },
        fix: function (p) {
          return p.len < 120 ? 'Ajoutez un bénéfice et une raison de cliquer\u00A0: il vous reste environ ' + n(155 - p.len) + ' caractères.'
            : 'Retirez environ ' + n(p.len - 155) + ' caractères pour que la phrase se termine avant la coupure.';
        }
      },
      'slug.words': {
        pass: 'L\u2019URL est courte',
        warn: 'L\u2019URL est plus longue que nécessaire',
        fail: 'L\u2019URL est beaucoup trop longue',
        na: 'Aucune URL fournie',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une URL pour lancer ces vérifications.';
          return n(p.count) + ' mots (visez 5 ou moins).';
        },
        fix: function () { return 'Retirez les mots de remplissage\u00A0; gardez les noms qui décrivent la page.'; }
      },
      'slug.separator': {
        pass: 'L\u2019URL utilise des traits d\u2019union',
        warn: 'Les séparateurs de l\u2019URL sont incohérents',
        fail: 'L\u2019URL utilise des soulignés ou des espaces',
        na: 'Aucune URL fournie',
        detail: function (p, s) { return s === 'na' ? 'Ajoutez une URL pour lancer ces vérifications.' : 'URL' + NBSP + ': ' + p.slug; },
        fix: function () { return 'Séparez les mots par des traits d\u2019union\u00A0: Google traite le souligné comme un liant, pas comme un séparateur.'; }
      },
      'slug.stopwords': {
        pass: 'L\u2019URL ne contient pas de mots vides',
        warn: 'L\u2019URL contient des mots vides',
        fail: 'L\u2019URL est surtout composée de mots vides',
        na: 'Aucune URL fournie',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une URL pour lancer ces vérifications.';
          return p.found.length ? 'Trouvés\u00A0: ' + p.found.join(', ') + '.' : 'Aucun mot vide trouvé.';
        },
        fix: function () { return 'Retirez les petits mots de liaison\u00A0: ils allongent sans rien ajouter.'; }
      },
      'slug.format': {
        pass: 'L\u2019URL est en minuscules et propre',
        warn: 'L\u2019URL contient des caractères à retirer',
        fail: 'L\u2019URL contient des majuscules ou des caractères risqués',
        na: 'Aucune URL fournie',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une URL pour lancer ces vérifications.';
          return p.issues.length ? p.issues.join(' ') : 'Uniquement des minuscules, des chiffres et des traits d\u2019union.';
        },
        fix: function () { return 'Tout en minuscules, et supprimez ce qui n\u2019est ni lettre, ni chiffre, ni trait d\u2019union.'; }
      },
      'slug.dates': {
        pass: 'L\u2019URL ne contient pas de date',
        warn: 'L\u2019URL contient une année',
        fail: 'L\u2019URL contient une date complète',
        na: 'Aucune URL fournie',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez une URL pour lancer ces vérifications.';
          return s === 'pass' ? 'Aucune année ni fragment de date.' : 'Trouvé\u00A0: ' + p.found + '.';
        },
        fix: function () { return 'Gardez l\u2019année dans le titre, modifiable, plutôt que dans une URL qu\u2019il faudrait rediriger.'; }
      },

      'struct.words': {
        pass: 'Le nombre de mots est compétitif',
        warn: 'Le contenu est mince pour une requête compétitive',
        fail: 'Le nombre de mots est sous le plancher',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de structure.';
          return n(p.words) + ' mots. 300 est le plancher\u00A0; environ 900 est le seuil des pages compétitives.';
        },
        fix: function (p) {
          var gap = p.words < 300 ? 300 - p.words : 900 - p.words;
          return 'Ajoutez environ ' + n(gap) + ' mots de substance\u00A0: exemples, chiffres, une vraie objection traitée.';
        }
      },
      'struct.h1': {
        pass: 'Exactement un H1',
        warn: 'Le H1 est absent',
        fail: 'Plus d\u2019un H1',
        na: 'Aucun contenu fourni',
        detail: function (p, s) { return s === 'na' ? 'Collez du contenu pour lancer les vérifications de structure.' : n(p.count) + ' élément(s) H1 trouvé(s).'; },
        fix: function (p) { return p.count === 0 ? 'Ajoutez un H1 qui énonce le sujet de la page.' : 'Rétrogradez les H1 en trop en H2\u00A0: une page, un H1.'; }
      },
      'struct.hierarchy': {
        pass: 'Les niveaux de titres sont en ordre',
        warn: 'Les titres commencent sous le H2',
        fail: 'Un niveau de titre est sauté',
        na: 'Pas assez de titres pour vérifier l\u2019ordre',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez des sous-titres pour structurer la page.';
          return s === 'fail' ? 'Saut détecté\u00A0: H' + n(p.from) + ' directement à H' + n(p.to) + '.' : 'Niveaux utilisés\u00A0: ' + p.used.join(', ') + '.';
        },
        fix: function () { return 'Descendez un niveau à la fois. Un H2 suivi d\u2019un H4 signale une section manquante.'; }
      },
      'struct.gap': {
        pass: 'Aucun long passage sans sous-titre',
        warn: 'Un passage s\u2019étire longtemps sans sous-titre',
        fail: 'Un très long passage n\u2019a aucun sous-titre',
        na: 'Contenu insuffisant',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de structure.';
          return 'Plus long passage\u00A0: ' + n(p.longest) + ' mots (alerte au-delà de 300).';
        },
        fix: function () { return 'Coupez le passage avec un H2 ou un H3 qui répond à la question que le lecteur se pose là.'; }
      },
      'struct.paragraphs': {
        pass: 'Le nombre de paragraphes est sain',
        warn: 'Très peu de paragraphes',
        fail: 'Le contenu forme un seul bloc',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de structure.';
          return n(p.count) + ' paragraphes, ' + n(p.avg) + ' mots chacun en moyenne.';
        },
        fix: function () { return 'Découpez selon les idées\u00A0: une affirmation par paragraphe rend la page lisible et citable.'; }
      },
      'struct.longpara': {
        pass: 'Aucun paragraphe démesuré',
        warn: 'Un paragraphe est long',
        fail: 'Un paragraphe est beaucoup trop long',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de structure.';
          return 'Plus long paragraphe\u00A0: ' + n(p.longest) + ' mots (alerte au-delà de 150).';
        },
        fix: function () { return 'Coupez le plus long paragraphe en deux, à son point de bascule naturel.'; }
      },
      'struct.lists': {
        pass: 'Le contenu comprend une liste ou un tableau',
        warn: 'Une seule liste très courte',
        fail: 'Aucune liste ni tableau',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de structure.';
          return n(p.lists) + ' liste(s), ' + n(p.items) + ' éléments, ' + n(p.tables) + ' tableau(x).';
        },
        fix: function () { return 'Transformez un paragraphe énumératif en vraie liste\u00A0: c\u2019est le format que lecteurs et modèles reprennent.'; }
      },

      'read.flesch': {
        pass: 'La facilité de lecture est confortable',
        warn: 'La lecture est exigeante',
        fail: 'La lecture est très exigeante',
        na: 'Contenu insuffisant pour évaluer la lisibilité',
        detail: function (p, s) {
          if (s === 'na') return 'La lisibilité exige quelques phrases complètes.';
          return 'Facilité de lecture Flesch ' + n(p.score) + ' —' + NBSP + p.band + '.';
        },
        fix: function () { return 'Raccourcissez les phrases et remplacez les mots longs. Visez 60 ou plus pour une page marketing.'; }
      },
      'read.sentence': {
        pass: 'La longueur moyenne des phrases est correcte',
        warn: 'Les phrases sont longues en moyenne',
        fail: 'Les phrases sont beaucoup trop longues',
        na: 'Pas assez de phrases pour mesurer',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez quelques phrases complètes pour mesurer.';
          return n(p.avg) + ' mots par phrase sur ' + n(p.count) + ' phrases (visez 20 ou moins).';
        },
        fix: function () { return 'Repérez les phrases les plus longues et coupez chacune en deux, à la virgule.'; }
      },
      'read.longsentences': {
        pass: 'Peu de phrases très longues',
        warn: 'Beaucoup de phrases dépassent 25 mots',
        fail: 'La majorité des phrases dépassent 25 mots',
        na: 'Pas assez de phrases pour mesurer',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez quelques phrases complètes pour mesurer.';
          return n(p.count) + ' phrases sur ' + n(p.total) + ' dépassent 25 mots = ' + n(p.share) + NBSP + '% (alerte au-delà de 25' + NBSP + '%).';
        },
        fix: function () { return 'Réécrivez les pires en deux phrases chacune.'; }
      },
      'read.passive': {
        pass: 'La voix passive reste maîtrisée',
        warn: 'La voix passive est fréquente',
        fail: 'La voix passive domine',
        na: 'Pas assez de phrases pour estimer',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez quelques phrases complètes pour mesurer.';
          return 'Environ ' + n(p.share) + NBSP + '% des phrases semblent passives (' + n(p.count) + ' sur ' + n(p.total) + '). Estimation heuristique, pas une analyse grammaticale.';
        },
        fix: function () { return 'Nommez l\u2019acteur\u00A0: «' + NBSP + 'nous avons réduit les coûts de 30' + NBSP + '%' + NBSP + '» vaut mieux que «' + NBSP + 'les coûts ont été réduits' + NBSP + '».'; }
      },
      'read.transitions': {
        pass: 'Les mots de transition relient les idées',
        warn: 'Peu de mots de transition',
        fail: 'Presque aucun mot de transition',
        na: 'Pas assez de phrases pour mesurer',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez quelques phrases complètes pour mesurer.';
          return n(p.share) + NBSP + '% des phrases contiennent une transition (visez 30' + NBSP + '%).';
        },
        fix: function () { return 'Ajoutez des connecteurs — «' + NBSP + 'mais' + NBSP + '», «' + NBSP + 'donc' + NBSP + '», «' + NBSP + 'par exemple' + NBSP + '» — là où une idée répond à la précédente.'; }
      },
      'read.syllables': {
        pass: 'Les mots restent simples',
        warn: 'Les mots sont longs',
        fail: 'Les mots sont très longs',
        na: 'Pas assez de mots pour mesurer',
        detail: function (p, s) {
          if (s === 'na') return 'Collez plus de contenu pour mesurer.';
          return n(p.avg) + ' syllabes par mot en moyenne (une écriture simple tourne autour de 1,5).';
        },
        fix: function () { return 'Remplacez les noms abstraits par des verbes\u00A0: «' + NBSP + 'nous testons' + NBSP + '» plutôt que «' + NBSP + 'mise en place de tests' + NBSP + '».'; }
      },

      'links.total': {
        pass: 'La page contient des liens',
        warn: 'Très peu de liens',
        fail: 'Aucun lien',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de liens.';
          return n(p.total) + ' lien(s)\u00A0: ' + n(p.internal) + ' internes, ' + n(p.external) + ' externes.';
        },
        fix: function () { return 'Ajoutez des liens là où le lecteur voudrait approfondir\u00A0: c\u2019est aussi là que le robot les attend.'; }
      },
      'links.internal': {
        pass: 'Des liens internes sont présents',
        warn: 'Un seul lien interne',
        fail: 'Aucun lien interne',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de liens.';
          return n(p.internal) + ' lien(s) interne(s). C\u2019est l\u2019oubli le plus fréquent sur une nouvelle page.';
        },
        fix: function () { return 'Reliez deux ou trois pages connexes avec une ancre descriptive, jamais «' + NBSP + 'cliquez ici' + NBSP + '».'; }
      },
      'links.external': {
        pass: 'Des sources externes sont citées',
        warn: 'Aucune source externe citée',
        fail: 'Aucune source externe citée',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de liens.';
          return n(p.external) + ' lien(s) externe(s).';
        },
        fix: function () { return 'Citez la source de votre affirmation la plus forte\u00A0: c\u2019est un signal de confiance pour les lecteurs comme pour les modèles.'; }
      },
      'links.naked': {
        pass: 'Aucune URL brute dans le texte',
        warn: 'Des URL brutes sont collées dans le texte',
        fail: 'Plusieurs URL brutes sont collées dans le texte',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de liens.';
          return n(p.count) + ' URL brute(s) dans la copie.';
        },
        fix: function () { return 'Transformez-les en vrais liens dont l\u2019ancre dit où ils mènent.'; }
      },
      'media.images': {
        pass: 'Le contenu contient des images',
        warn: 'Une seule image',
        fail: 'Aucune image',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer les vérifications de médias.';
          return n(p.count) + ' image(s) détectée(s) en HTML et en Markdown.';
        },
        fix: function () { return 'Ajoutez une capture, un graphique ou une photo du travail réel. Une image par 300 mots est un bon rythme.'; }
      },
      'media.alt': {
        pass: 'Toutes les images ont un texte alternatif',
        warn: 'Des images n\u2019ont pas de texte alternatif',
        fail: 'La plupart des images n\u2019ont pas de texte alternatif',
        na: 'Aucune image à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'La couverture des textes alternatifs n\u2019a de sens qu\u2019avec au moins une image.';
          return n(p.withAlt) + ' image(s) sur ' + n(p.total) + ' ont un texte alternatif.';
        },
        fix: function () { return 'Décrivez ce que montre l\u2019image, dans une phrase qu\u2019une personne dirait à voix haute.'; }
      },
      'media.altempty': {
        pass: 'Aucun attribut alt vide',
        warn: 'Des attributs alt sont vides',
        fail: 'Plusieurs attributs alt sont vides',
        na: 'Aucune image à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'La couverture des textes alternatifs n\u2019a de sens qu\u2019avec au moins une image.';
          return n(p.count) + ' image(s) portent un alt vide.';
        },
        fix: function () { return 'Un alt vide ne convient qu\u2019à une image purement décorative. Si elle porte du sens, décrivez-la.'; }
      },
      'media.altfilename': {
        pass: 'Aucun texte alternatif ne recopie le nom de fichier',
        warn: 'Un texte alternatif recopie le nom de fichier',
        fail: 'Des textes alternatifs recopient le nom de fichier',
        na: 'Aucune image à vérifier',
        detail: function (p, s) {
          if (s === 'na') return 'La couverture des textes alternatifs n\u2019a de sens qu\u2019avec au moins une image.';
          return n(p.count) + ' valeur(s) alt ne sont que le nom du fichier.';
        },
        fix: function () { return 'Remplacez «' + NBSP + 'capture-tableau-de-bord' + NBSP + '» par ce que la capture montre vraiment.'; }
      },

      'aeo.answer': {
        pass: 'Une réponse directe apparaît en tête',
        warn: 'L\u2019introduction s\u2019approche d\u2019une réponse directe',
        fail: 'Aucune réponse directe en introduction',
        na: 'Contenu insuffisant',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez un paragraphe d\u2019introduction pour lancer cette vérification.';
          return s === 'pass'
            ? 'Phrase-réponse de ' + n(p.len) + ' mots trouvée dans l\u2019introduction.'
            : 'Aucune phrase de 15 à 45 mots en introduction ne contient à la fois le mot-clé et un verbe de définition. Heuristique, pas un signal de classement.';
        },
        fix: function () { return 'Ouvrez par une phrase autonome qui répond à la requête en 15 à 45 mots.'; }
      },
      'aeo.questions': {
        pass: 'Des sous-titres sont formulés en questions',
        warn: 'Un seul sous-titre en question',
        fail: 'Aucun sous-titre formulé en question',
        na: 'Aucun sous-titre trouvé',
        detail: function (p, s) {
          if (s === 'na') return 'Ajoutez des sous-titres pour lancer cette vérification.';
          return n(p.count) + ' sous-titres sur ' + n(p.total) + ' se lisent comme des questions.';
        },
        fix: function () { return 'Formulez deux sous-titres comme une personne les taperait, puis répondez dès la première ligne dessous.'; }
      },
      'aeo.liftable': {
        pass: 'Une liste ou un tableau peut être repris',
        warn: 'Une liste très courte seulement',
        fail: 'Rien de structuré à reprendre',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer cette vérification.';
          return n(p.items) + ' élément(s) de liste et ' + n(p.tables) + ' tableau(x). Heuristique de citabilité.';
        },
        fix: function () { return 'Ajoutez une courte liste d\u2019étapes ou de critères\u00A0: c\u2019est ce que les moteurs de réponse citent.'; }
      },
      'aeo.specifics': {
        pass: 'Le contenu est concret',
        warn: 'Le contenu manque de détails concrets',
        fail: 'Le contenu n\u2019a presque aucun détail concret',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer cette vérification.';
          return n(p.count) + ' détails concrets (nombres, pourcentages, dates, entités nommées) sur ' + n(p.words) + ' mots.';
        },
        fix: function () { return 'Remplacez un adjectif par un chiffre. «' + NBSP + 'Rapide' + NBSP + '» ne se cite pas\u00A0; «' + NBSP + 'moins de 200' + NBSP + 'ms' + NBSP + '» oui.'; }
      },
      'aeo.parasentences': {
        pass: 'Les paragraphes sont courts et autonomes',
        warn: 'Les paragraphes sont longs pour être cités',
        fail: 'Les paragraphes sont trop longs pour être repris',
        na: 'Aucun contenu fourni',
        detail: function (p, s) {
          if (s === 'na') return 'Collez du contenu pour lancer cette vérification.';
          return n(p.avg) + ' phrases par paragraphe en moyenne. Les passages de 2 à 4 phrases sont les plus cités — une heuristique, pas une règle.';
        },
        fix: function () { return 'Gardez un paragraphe par affirmation, avec sa preuve.'; }
      },
      'aeo.definition': {
        pass: 'Une phrase de définition est présente',
        warn: 'La phrase de définition reste vague',
        fail: 'Aucune phrase de définition',
        na: 'Contenu insuffisant',
        detail: function (p, s) {
          if (s === 'na') return 'Écrivez quelques phrases pour lancer cette vérification.';
          return s === 'pass' ? 'Phrase de la forme «' + NBSP + 'X est un…' + NBSP + '» trouvée.' : 'Aucune phrase de la forme «' + NBSP + 'X est un…' + NBSP + '» trouvée. Heuristique de citabilité.';
        },
        fix: function () { return 'Ajoutez une définition simple\u00A0: le sujet, «' + NBSP + 'est' + NBSP + '», et ce que c\u2019est.'; }
      }
    };
  }
  defineChecks();

  /** Build one check record. Statuses other than 'pass' always carry a fix. */
  function check(id, group, status, params) {
    var m = STRINGS[LANG].checks[id];
    var p = params || {};
    return {
      id: id,
      group: group,
      status: status,
      weight: WEIGHTS[id] || 0,
      label: m[status],
      detail: m.detail(p, status),
      fix: status === 'pass' || status === 'na' ? '' : m.fix(p, status)
    };
  }

  // ---- Group 1: focus keyword --------------------------------------------
  function keywordChecks(input, model) {
    var out = [];
    var kw = normalizeForMatch(input.keyword);
    var kwDisplay = input.keyword.trim();
    if (!kw) {
      // Nothing to measure: every keyword check is 'na' and leaves the denominator.
      var ids = ['kw.title', 'kw.meta', 'kw.slug', 'kw.h1', 'kw.intro', 'kw.subheads', 'kw.density', 'kw.exact'];
      for (var i = 0; i < ids.length; i++) out.push(check(ids[i], 'keyword', 'na', {}));
      return out;
    }

    // title
    if (!input.title.trim()) {
      out.push(check('kw.title', 'keyword', 'na', {}));
    } else {
      var nTitle = normalizeForMatch(input.title);
      var at = indexOfPhrase(nTitle, kw);
      var st = at === -1 ? 'fail' : (at <= Math.max(10, nTitle.length * 0.4) ? 'pass' : 'warn');
      out.push(check('kw.title', 'keyword', st, { pos: at + 1, len: input.title.length, keyword: kwDisplay }));
    }

    // meta description
    if (!input.meta.trim()) {
      out.push(check('kw.meta', 'keyword', 'na', {}));
    } else {
      var hitsMeta = countPhrase(normalizeForMatch(input.meta), kw);
      var partial = hitsMeta === 0 && keywordPartlyIn(normalizeForMatch(input.meta), kw);
      out.push(check('kw.meta', 'keyword', hitsMeta > 0 ? 'pass' : (partial ? 'warn' : 'fail'),
        { hits: hitsMeta, len: input.meta.length }));
    }

    // slug
    if (!input.slug.trim()) {
      out.push(check('kw.slug', 'keyword', 'na', {}));
    } else {
      var nSlug = normalizeForMatch(input.slug);
      var slugHit = countPhrase(nSlug, kw) > 0;
      var slugPartial = !slugHit && keywordPartlyIn(nSlug, kw);
      out.push(check('kw.slug', 'keyword', slugHit ? 'pass' : (slugPartial ? 'warn' : 'fail'),
        { slug: input.slug.trim(), suggestion: kw.replace(/ /g, '-') }));
    }

    // H1
    var h1 = null;
    for (var h = 0; h < model.headings.length; h++) {
      if (model.headings[h].level === 1) { h1 = model.headings[h]; break; }
    }
    if (!h1) {
      out.push(check('kw.h1', 'keyword', 'na', {}));
    } else {
      var nH1 = normalizeForMatch(h1.text);
      var h1Hit = countPhrase(nH1, kw) > 0;
      var h1Partial = !h1Hit && keywordPartlyIn(nH1, kw);
      out.push(check('kw.h1', 'keyword', h1Hit ? 'pass' : (h1Partial ? 'warn' : 'fail'),
        { h1: h1.text, keyword: kwDisplay }));
    }

    // first 100 words
    if (model.words.length < 20) {
      out.push(check('kw.intro', 'keyword', 'na', {}));
    } else {
      var introAt = indexOfPhrase(model.firstWords, kw);
      var wordAt = introAt === -1 ? -1 : model.firstWords.slice(0, introAt).split(' ').length;
      var introStatus = introAt === -1 ? 'fail' : (wordAt <= 50 ? 'pass' : 'warn');
      out.push(check('kw.intro', 'keyword', introStatus, { at: wordAt }));
    }

    // subheadings
    var subs = model.headings.filter(function (x) { return x.level >= 2; });
    if (!subs.length) {
      out.push(check('kw.subheads', 'keyword', 'na', {}));
    } else {
      var subHits = 0;
      for (var s = 0; s < subs.length; s++) {
        if (countPhrase(normalizeForMatch(subs[s].text), kw) > 0) subHits++;
      }
      out.push(check('kw.subheads', 'keyword', subHits >= 2 ? 'pass' : (subHits === 1 ? 'warn' : 'fail'),
        { hits: subHits, total: subs.length }));
    }

    /* DENSITY — DEFECT 3. Denominator is model.words.length (TOTAL words). The
     * reference tool divides by the number of UNIQUE tokens, which on a 900-word
     * article with ~350 unique tokens inflates every figure by ~2.6x and pushes
     * ordinary writing into a fake "stuffing" warning. */
    var hits = countPhrase(model.norm, kw);
    if (model.words.length < 50) {
      out.push(check('kw.density', 'keyword', 'na', {}));
    } else {
      var density = round1(pct(hits, model.words.length));
      var dStatus = density > 3.5 ? 'fail' : (density >= 0.5 && density <= 2.5 ? 'pass' : 'warn');
      var ideal = Math.round((2.5 / 100) * model.words.length);
      out.push(check('kw.density', 'keyword', dStatus, {
        hits: hits, words: model.words.length, density: density, excess: Math.max(1, hits - ideal)
      }));
    }

    /* With a keyword typed and the content box still empty, this was the ONE check
     * that ran, so the panel opened on a red 0/100 "Poor" ring and "the exact phrase
     * never appears in the body" — a fail for a body that does not exist yet. Same
     * rule as everywhere else here: a check that cannot run is 'na', not a zero. */
    if (!model.words.length) {
      out.push(check('kw.exact', 'keyword', 'na', {}));
    } else {
      out.push(check('kw.exact', 'keyword', hits >= 2 ? 'pass' : (hits === 1 ? 'warn' : 'fail'), { hits: hits }));
    }
    return out;
  }

  /** "Partly there": every keyword token appears, but not as a contiguous phrase. */
  function keywordPartlyIn(normalizedHaystack, normalizedKeyword) {
    var parts = normalizedKeyword.split(' ').filter(Boolean);
    if (parts.length < 2) return false;
    for (var i = 0; i < parts.length; i++) {
      if (countPhrase(normalizedHaystack, parts[i]) === 0) return false;
    }
    return true;
  }

  // ---- Group 2: title, meta, slug ----------------------------------------
  var SLUG_STOPWORDS = {
    en: ['a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'at', 'is', 'are', 'with', 'your', 'you', 'how', 'best'],
    fr: ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'pour', 'dans', 'sur', 'avec', 'votre', 'vos', 'comment']
  };

  function metaChecks(input) {
    var out = [];
    var title = input.title.trim();
    if (!title) {
      out.push(check('title.length', 'meta', 'na', {}));
      out.push(check('title.pixels', 'meta', 'na', {}));
    } else {
      var len = title.length;
      var tStatus = (len < 25 || len > 65) ? 'fail' : (len >= 50 && len <= 60 ? 'pass' : 'warn');
      out.push(check('title.length', 'meta', tStatus, { len: len }));
      var px = pixelWidth(title);
      var pStatus = px > 580 ? 'fail' : (px > 545 ? 'warn' : 'pass');
      out.push(check('title.pixels', 'meta', pStatus, { px: px }));
    }

    var meta = input.meta.trim();
    if (!meta) {
      out.push(check('meta.length', 'meta', 'na', {}));
    } else {
      var mlen = meta.length;
      var mStatus = (mlen < 70 || mlen > 165) ? 'fail' : (mlen >= 120 && mlen <= 160 ? 'pass' : 'warn');
      out.push(check('meta.length', 'meta', mStatus, { len: mlen }));
    }

    var slug = input.slug.trim().replace(/^\/+|\/+$/g, '');
    if (!slug) {
      out.push(check('slug.words', 'meta', 'na', {}));
      out.push(check('slug.separator', 'meta', 'na', {}));
      out.push(check('slug.stopwords', 'meta', 'na', {}));
      out.push(check('slug.format', 'meta', 'na', {}));
      out.push(check('slug.dates', 'meta', 'na', {}));
      return out;
    }

    var slugWords = slug.split(/[-_\s/]+/).filter(Boolean);
    out.push(check('slug.words', 'meta', slugWords.length <= 5 ? 'pass' : (slugWords.length <= 7 ? 'warn' : 'fail'),
      { count: slugWords.length }));

    var hasUnderscore = /_/.test(slug) || /\s/.test(slug);
    var hasHyphen = /-/.test(slug);
    out.push(check('slug.separator', 'meta', hasUnderscore ? 'fail' : (slugWords.length > 1 && !hasHyphen ? 'warn' : 'pass'),
      { slug: slug }));

    var stops = SLUG_STOPWORDS[LANG];
    var found = [];
    for (var i = 0; i < slugWords.length; i++) {
      var w = deaccent(slugWords[i].toLowerCase());
      if (stops.indexOf(w) !== -1 && found.indexOf(w) === -1) found.push(w);
    }
    out.push(check('slug.stopwords', 'meta',
      found.length === 0 ? 'pass' : (found.length <= 1 ? 'warn' : 'fail'), { found: found }));

    var issues = [];
    if (/[A-Z]/.test(slug)) issues.push(LANG === 'fr' ? 'Contient des majuscules.' : 'Contains uppercase letters.');
    var stray = slug.replace(/[A-Za-z0-9\-_/]/g, '');
    if (stray) issues.push((LANG === 'fr' ? 'Caractères hors norme\u00A0: ' : 'Non-standard characters: ') + stray + '.');
    out.push(check('slug.format', 'meta', issues.length === 0 ? 'pass' : (issues.length === 1 ? 'warn' : 'fail'),
      { issues: issues }));

    var dateFull = /(^|[-_/])(19|20)\d{2}[-_/](0?[1-9]|1[0-2])([-_/]|$)/.exec(slug);
    var yearOnly = /(^|[-_/])(19|20)\d{2}([-_/]|$)/.exec(slug);
    out.push(check('slug.dates', 'meta', dateFull ? 'fail' : (yearOnly ? 'warn' : 'pass'),
      { found: dateFull ? dateFull[0] : (yearOnly ? yearOnly[0] : '') }));

    return out;
  }

  // ---- Group 3: structure -------------------------------------------------
  function structureChecks(model) {
    var out = [];
    var wc = model.words.length;
    if (!wc) {
      var ids = ['struct.words', 'struct.h1', 'struct.hierarchy', 'struct.gap', 'struct.paragraphs', 'struct.longpara', 'struct.lists'];
      for (var i = 0; i < ids.length; i++) out.push(check(ids[i], 'structure', 'na', {}));
      return out;
    }

    /* Two thresholds, both stated. The reference tool hard-codes a single 500-word
     * "good" line, which flags a perfectly fine 380-word local landing page and
     * blesses a 520-word page competing against 2,000-word guides. */
    out.push(check('struct.words', 'structure', wc >= 900 ? 'pass' : (wc >= 300 ? 'warn' : 'fail'), { words: wc }));

    var h1s = model.headings.filter(function (h) { return h.level === 1; }).length;
    out.push(check('struct.h1', 'structure', h1s === 1 ? 'pass' : (h1s === 0 ? 'warn' : 'fail'), { count: h1s }));

    if (model.headings.length < 2) {
      out.push(check('struct.hierarchy', 'structure', 'na', {}));
    } else {
      var skipped = null;
      var used = [];
      for (var j = 0; j < model.headings.length; j++) {
        var lvl = model.headings[j].level;
        if (used.indexOf('H' + lvl) === -1) used.push('H' + lvl);
        if (j > 0 && lvl - model.headings[j - 1].level > 1 && !skipped) {
          skipped = { from: model.headings[j - 1].level, to: lvl };
        }
      }
      used.sort();
      var startsDeep = model.headings[0].level > 2;
      out.push(check('struct.hierarchy', 'structure', skipped ? 'fail' : (startsDeep ? 'warn' : 'pass'),
        { from: skipped ? skipped.from : 0, to: skipped ? skipped.to : 0, used: used }));
    }

    var longestRun = 0;
    for (var k = 0; k < model.segments.length; k++) longestRun = Math.max(longestRun, model.segments[k]);
    out.push(check('struct.gap', 'structure', longestRun <= 300 ? 'pass' : (longestRun <= 500 ? 'warn' : 'fail'),
      { longest: longestRun }));

    var paras = model.paragraphs;
    var avgPara = paras.length ? Math.round(wc / paras.length) : 0;
    out.push(check('struct.paragraphs', 'structure', paras.length >= 4 ? 'pass' : (paras.length >= 2 ? 'warn' : 'fail'),
      { count: paras.length, avg: avgPara }));

    var longestPara = 0;
    for (var p = 0; p < paras.length; p++) longestPara = Math.max(longestPara, wordsOf(paras[p]).length);
    out.push(check('struct.longpara', 'structure', longestPara <= 150 ? 'pass' : (longestPara <= 250 ? 'warn' : 'fail'),
      { longest: longestPara }));

    var structured = model.listItems >= 3 || model.tables > 0;
    out.push(check('struct.lists', 'structure', structured ? 'pass' : (model.listItems > 0 ? 'warn' : 'fail'),
      { lists: model.lists, items: model.listItems, tables: model.tables }));

    return out;
  }

  // ---- Group 4: readability ----------------------------------------------
  function readabilityChecks(model) {
    var out = [];
    var wc = model.words.length;
    var sc = model.sentences.length;
    if (wc < 30 || sc < 2) {
      var ids = ['read.flesch', 'read.sentence', 'read.longsentences', 'read.passive', 'read.transitions', 'read.syllables'];
      for (var i = 0; i < ids.length; i++) out.push(check(ids[i], 'readability', 'na', {}));
      return out;
    }

    var syl = totalSyllables(model.words);
    var flesch = round1(fleschScore(wc, sc, syl));
    out.push(check('read.flesch', 'readability', flesch >= 60 ? 'pass' : (flesch >= 45 ? 'warn' : 'fail'),
      { score: flesch, band: fleschBand(flesch) }));

    var avgSentence = round1(wc / sc);
    out.push(check('read.sentence', 'readability', avgSentence <= 20 ? 'pass' : (avgSentence <= 25 ? 'warn' : 'fail'),
      { avg: avgSentence, count: sc }));

    var longCount = 0;
    for (var j = 0; j < model.sentences.length; j++) {
      if (wordsOf(model.sentences[j]).length > 25) longCount++;
    }
    var longShare = round1(pct(longCount, sc));
    out.push(check('read.longsentences', 'readability', longShare <= 25 ? 'pass' : (longShare <= 40 ? 'warn' : 'fail'),
      { count: longCount, total: sc, share: longShare }));

    var passiveCount = passiveSentences(model.sentences);
    var passiveShare = round1(pct(passiveCount, sc));
    out.push(check('read.passive', 'readability', passiveShare <= 10 ? 'pass' : (passiveShare <= 20 ? 'warn' : 'fail'),
      { count: passiveCount, total: sc, share: passiveShare }));

    var transShare = round1(pct(transitionSentences(model.sentences), sc));
    out.push(check('read.transitions', 'readability', transShare >= 30 ? 'pass' : (transShare >= 15 ? 'warn' : 'fail'),
      { share: transShare }));

    var avgSyl = round1(syl / wc);
    out.push(check('read.syllables', 'readability', avgSyl <= 1.6 ? 'pass' : (avgSyl <= 1.9 ? 'warn' : 'fail'),
      { avg: avgSyl }));

    return out;
  }

  // ---- Group 5: links and media -------------------------------------------
  function linkChecks(model) {
    var out = [];
    if (!model.words.length && !model.links.length && !model.images.length) {
      var ids = ['links.total', 'links.internal', 'links.external', 'links.naked'];
      for (var i = 0; i < ids.length; i++) out.push(check(ids[i], 'links', 'na', {}));
    } else {
      /* Counted by KIND. mailto:, tel:, javascript: and #fragments are links a
       * reader can use but not paths to another page, so they belong to neither
       * column and to no total — otherwise a mailto and a phone number "passed"
       * the internal-link check. */
      var internal = 0, external = 0;
      for (var j = 0; j < model.links.length; j++) {
        var kind = model.links[j].kind;
        if (kind === 'external') external++;
        else if (kind === 'internal') internal++;
      }
      var total = internal + external;
      out.push(check('links.total', 'links', total >= 3 ? 'pass' : (total >= 1 ? 'warn' : 'fail'),
        { total: total, internal: internal, external: external }));
      out.push(check('links.internal', 'links', internal >= 2 ? 'pass' : (internal === 1 ? 'warn' : 'fail'),
        { internal: internal }));
      out.push(check('links.external', 'links', external >= 1 ? 'pass' : 'warn', { external: external }));
      var naked = model.nakedUrls.length;
      out.push(check('links.naked', 'links', naked === 0 ? 'pass' : (naked <= 2 ? 'warn' : 'fail'), { count: naked }));
    }

    // DEFECT 2 in full: images from both syntaxes, and alt COVERAGE reported.
    var imgs = model.images;
    if (!model.words.length && !imgs.length) {
      // An empty form is not a page with missing images. Scoring it as a fail would
      // put a red 0 on screen before the user has typed anything.
      out.push(check('media.images', 'links', 'na', {}));
    } else {
      out.push(check('media.images', 'links', imgs.length >= 2 ? 'pass' : (imgs.length === 1 ? 'warn' : 'fail'),
        { count: imgs.length }));
    }

    if (!imgs.length) {
      out.push(check('media.alt', 'links', 'na', {}));
      out.push(check('media.altempty', 'links', 'na', {}));
      out.push(check('media.altfilename', 'links', 'na', {}));
      return out;
    }

    var withAlt = 0, empty = 0, filenameAlt = 0;
    for (var k = 0; k < imgs.length; k++) {
      var alt = imgs[k].alt;
      if (alt === null || alt === undefined) continue;      // attribute absent entirely
      if (!String(alt).trim()) { empty++; continue; }        // alt="" — decorative or forgotten
      withAlt++;
      var base = String(imgs[k].src).split(/[?#]/)[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '');
      if (base && normalizeForMatch(base) === normalizeForMatch(alt)) filenameAlt++;
    }
    var coverage = pct(withAlt, imgs.length);
    out.push(check('media.alt', 'links', coverage === 100 ? 'pass' : (coverage >= 50 ? 'warn' : 'fail'),
      { withAlt: withAlt, total: imgs.length }));
    out.push(check('media.altempty', 'links', empty === 0 ? 'pass' : (empty === 1 ? 'warn' : 'fail'), { count: empty }));
    out.push(check('media.altfilename', 'links', filenameAlt === 0 ? 'pass' : (filenameAlt === 1 ? 'warn' : 'fail'),
      { count: filenameAlt }));

    return out;
  }

  // ---- Group 6: answer-engine readiness -----------------------------------
  /* Every check in this group is a HEURISTIC for citability and says so in its own
   * detail string, plus once more in the group note. We sell AI search work; the
   * fastest way to lose that credibility is to imply a checkbox buys a citation. */
  function aeoChecks(input, model) {
    var out = [];
    var kw = normalizeForMatch(input.keyword);
    var copula = COPULA[LANG];

    // 1. direct answer in the opening
    if (!model.paragraphs.length || model.words.length < 30) {
      out.push(check('aeo.answer', 'aeo', 'na', {}));
    } else {
      var opening = model.paragraphs.slice(0, 2).join(' ');
      var openSentences = sentencesOf(opening);
      var best = null, nearMiss = false;
      for (var i = 0; i < openSentences.length; i++) {
        var sWords = wordsOf(openSentences[i]).length;
        var norm = ' ' + normalizeForMatch(openSentences[i]) + ' ';
        var hasVerb = false;
        for (var v = 0; v < copula.length; v++) {
          if (norm.indexOf(' ' + copula[v] + ' ') !== -1) { hasVerb = true; break; }
        }
        var hasKw = kw ? countPhrase(norm, kw) > 0 : false;
        if (sWords >= 15 && sWords <= 45 && hasVerb && hasKw) { best = sWords; break; }
        if ((hasVerb && sWords >= 15 && sWords <= 45) || (hasKw && hasVerb)) nearMiss = true;
      }
      out.push(check('aeo.answer', 'aeo', best ? 'pass' : (nearMiss ? 'warn' : 'fail'), { len: best || 0 }));
    }

    // 2. question-shaped subheadings
    var subs = model.headings.filter(function (h) { return h.level >= 2; });
    if (!subs.length) {
      out.push(check('aeo.questions', 'aeo', 'na', {}));
    } else {
      var starts = QUESTION_STARTS[LANG];
      var qCount = 0;
      for (var j = 0; j < subs.length; j++) {
        var t = normalizeForMatch(subs[j].text);
        var isQ = /\?\s*$/.test(subs[j].text);
        for (var q = 0; q < starts.length && !isQ; q++) {
          if (t === starts[q] || t.indexOf(starts[q] + ' ') === 0) isQ = true;
        }
        if (isQ) qCount++;
      }
      out.push(check('aeo.questions', 'aeo', qCount >= 2 ? 'pass' : (qCount === 1 ? 'warn' : 'fail'),
        { count: qCount, total: subs.length }));
    }

    // 3. something structured to lift
    if (!model.words.length) {
      out.push(check('aeo.liftable', 'aeo', 'na', {}));
    } else {
      var liftable = model.listItems >= 3 || model.tables > 0;
      out.push(check('aeo.liftable', 'aeo', liftable ? 'pass' : (model.listItems > 0 ? 'warn' : 'fail'),
        { items: model.listItems, tables: model.tables }));
    }

    // 4. concrete specifics
    if (!model.words.length) {
      out.push(check('aeo.specifics', 'aeo', 'na', {}));
    } else {
      var numbers = (model.text.match(/\b\d+([.,]\d+)?\s?%?/g) || []).length;
      var entities = 0;
      var tokens = model.text.split(/\s+/);
      for (var e = 1; e < tokens.length; e++) {
        var prev = tokens[e - 1];
        if (/[.!?]$/.test(prev)) continue;                 // sentence-initial capital is not a signal
        if (/^[A-Z\u00c0-\u00dc][\p{L}'\u2019-]{2,}$/u.test(tokens[e])) entities++;
      }
      var specifics = numbers + entities;
      var need = Math.max(3, Math.round(model.words.length / 150));
      out.push(check('aeo.specifics', 'aeo', specifics >= need ? 'pass' : (specifics >= Math.ceil(need / 2) ? 'warn' : 'fail'),
        { count: specifics, words: model.words.length }));
    }

    // 5. paragraph length in SENTENCES (short passages get cited)
    if (!model.paragraphs.length) {
      out.push(check('aeo.parasentences', 'aeo', 'na', {}));
    } else {
      var totalSent = 0;
      for (var pI = 0; pI < model.paragraphs.length; pI++) {
        totalSent += Math.max(1, sentencesOf(model.paragraphs[pI]).length);
      }
      var avgSent = round1(totalSent / model.paragraphs.length);
      out.push(check('aeo.parasentences', 'aeo', avgSent <= 4 ? 'pass' : (avgSent <= 6 ? 'warn' : 'fail'), { avg: avgSent }));
    }

    // 6. a definition-style sentence anywhere
    if (model.words.length < 30) {
      out.push(check('aeo.definition', 'aeo', 'na', {}));
    } else {
      var defRe = LANG === 'fr'
        ? /\b(est|sont)\s+(un|une|le|la|les|des)\s+\p{L}+/iu
        : /\b(is|are)\s+(a|an|the)\s+\p{L}+/iu;
      var hasDef = defRe.test(model.text);
      var weakDef = !hasDef && (LANG === 'fr' ? /\b(est|sont)\b/i.test(model.text) : /\b(is|are)\b/i.test(model.text));
      out.push(check('aeo.definition', 'aeo', hasDef ? 'pass' : (weakDef ? 'warn' : 'fail'), {}));
    }

    return out;
  }

  // =========================================================================
  //  7. SCORING
  // =========================================================================

  var FACTOR = { pass: 1, warn: 0.5, fail: 0 };

  /* Normalise by the weights of the checks that RAN. A check with status 'na' —
   * "you supplied no meta description, so its two checks could not run" — is
   * excluded from BOTH numerator and denominator. Counting it as a zero would mean
   * a page scored worse for a field the tool has no way to see, which is the kind
   * of dishonesty that makes a free tool worthless. */
  function scoreOf(checks) {
    var earned = 0, possible = 0, ran = 0;
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      if (c.status === 'na' || !c.weight) continue;
      earned += c.weight * FACTOR[c.status];
      possible += c.weight;
      ran++;
    }
    return { score: possible ? Math.round((earned / possible) * 100) : 0, ran: ran, possible: possible };
  }

  function gradeOf(score) {
    var g = T().grades;
    if (score >= 90) return g.excellent;
    if (score >= 75) return g.good;
    if (score >= 60) return g.work;
    return g.poor;
  }

  // =========================================================================
  //  8. WORD FREQUENCY
  // =========================================================================

  /* n-gram counts. Percentages use TOTAL words as the denominator for every tab,
   * matching the density check — see DEFECT 3. Stop words are removed from the
   * 1-word tab only: strip them from bigrams and "cost per click" becomes
   * "cost click", a phrase nobody typed. */
  function frequency(words, n) {
    var stops = STOP_WORDS[LANG];
    var counts = Object.create(null);
    for (var i = 0; i + n <= words.length; i++) {
      var gram = words.slice(i, i + n);
      if (n === 1) {
        var w = deaccent(gram[0]);
        if (w.length < 3 || stops.indexOf(w) !== -1 || /^\d+$/.test(w)) continue;
      }
      var key = gram.join(' ');
      counts[key] = (counts[key] || 0) + 1;
    }
    var rows = Object.keys(counts).map(function (k) {
      return { term: k, count: counts[k], share: round1(pct(counts[k], words.length)) };
    });
    rows.sort(function (a, b) { return b.count - a.count || (a.term < b.term ? -1 : 1); });
    return rows.slice(0, 10);
  }

  // =========================================================================
  //  ANALYZE — the one public entry point of the pure layer
  // =========================================================================

  var GROUP_ORDER = ['keyword', 'meta', 'structure', 'readability', 'links', 'aeo'];

  function analyze(input) {
    var model = buildModel(input.content);
    var checks = []
      .concat(keywordChecks(input, model))
      .concat(metaChecks(input))
      .concat(structureChecks(model))
      .concat(readabilityChecks(model))
      .concat(linkChecks(model))
      .concat(aeoChecks(input, model));

    var total = scoreOf(checks);
    var groups = GROUP_ORDER.map(function (g) {
      var inGroup = checks.filter(function (c) { return c.group === g; });
      return { id: g, name: T().groups[g], checks: sortWorstFirst(inGroup), score: scoreOf(inGroup) };
    });

    var syl = totalSyllables(model.words);
    return {
      model: model,
      checks: checks,
      groups: groups,
      score: total.score,
      ran: total.ran,
      grade: gradeOf(total.score),
      flesch: model.sentences.length ? round1(fleschScore(model.words.length, model.sentences.length, syl)) : 0,
      freq: {
        1: frequency(model.words, 1),
        2: frequency(model.words, 2),
        3: frequency(model.words, 3)
      }
    };
  }

  var STATUS_RANK = { fail: 0, warn: 1, pass: 2, na: 3 };
  function sortWorstFirst(list) {
    return list.slice().sort(function (a, b) {
      return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.weight - a.weight;
    });
  }

  // =========================================================================
  //  9. DOM LAYER
  // =========================================================================

  var $ = function (id) { return document.getElementById(id); };

  /** Element factory. textContent only — user content NEVER reaches innerHTML. */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  }

  var RING_R = 52;
  var RING_C = 2 * Math.PI * RING_R;

  /** The score ring. Inline SVG, stroke-dasharray, no canvas and no library. */
  function renderRing(score, grade, ran, words, truncated) {
    var wrap = el('div', 'ca-score');
    var dash = (RING_C * Math.max(0, Math.min(100, score))) / 100;
    var svg = el('div', 'ca-ring');
    // Static markup with computed NUMBERS only — no user string is interpolated here.
    svg.innerHTML =
      '<svg viewBox="0 0 120 120" class="ca-ring-svg" role="img" aria-label="' +
      UI().scoreAria({ score: score, grade: grade }).replace(/"/g, '') + '">' +
      '<circle class="ca-ring-track" cx="60" cy="60" r="' + RING_R + '" fill="none" stroke-width="10"></circle>' +
      '<circle class="ca-ring-value ca-ring-' + bandClass(score) + '" cx="60" cy="60" r="' + RING_R +
      '" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="' +
      dash.toFixed(2) + ' ' + RING_C.toFixed(2) + '" transform="rotate(-90 60 60)"></circle>' +
      '<text class="ca-ring-num" x="60" y="66" text-anchor="middle" font-size="30">' + score + '</text>' +
      '</svg>';
    wrap.appendChild(svg);

    var meta = el('div', 'ca-score-meta');
    meta.appendChild(el('p', 'ca-score-title', UI().scoreTitle));
    meta.appendChild(el('p', 'ca-score-grade ca-grade-' + bandClass(score), grade));
    meta.appendChild(el('p', 'ca-score-of', score + ' ' + UI().scoreOf));
    meta.appendChild(el('p', 'ca-score-note', UI().scoreNote({ ran: ran, words: words, grade: grade })));
    // Truncation is stated, never silent: a score computed on part of a document has
    // to say so, or the word count on screen is a lie.
    if (truncated) meta.appendChild(el('p', 'ca-score-note', UI().truncatedNote({ max: MAX_SOURCE })));
    wrap.appendChild(meta);
    return wrap;
  }

  function bandClass(score) {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'work';
    return 'poor';
  }

  function renderCheck(c) {
    var li = el('li', 'ca-check is-' + c.status);
    // Status is a WORD as well as a colour. The reference tool uses a bare coloured
    // dot, which is unreadable to anyone with a red/green deficiency and invisible
    // to a screen reader.
    li.appendChild(el('span', 'ca-status ca-status-' + c.status, T().status[c.status]));
    var body = el('div', 'ca-check-body');
    body.appendChild(el('p', 'ca-check-label', c.label));
    body.appendChild(el('p', 'ca-check-detail', c.detail));
    if (c.fix) body.appendChild(el('p', 'ca-check-fix', c.fix));
    li.appendChild(body);
    return li;
  }

  function renderGroup(group) {
    var sec = el('section', 'ca-group');
    var head = el('div', 'ca-group-head');
    head.appendChild(el('h3', 'ca-group-title', group.name));
    var sub = group.score.possible
      ? UI().groupScore({ pct: group.score.score })
      : T().status.na;
    head.appendChild(el('span', 'ca-group-score ca-grade-' + bandClass(group.score.score), sub));
    sec.appendChild(head);
    if (group.id === 'aeo') sec.appendChild(el('p', 'ca-group-note', UI().aeoNote));
    var ul = el('ul', 'ca-checks');
    for (var i = 0; i < group.checks.length; i++) ul.appendChild(renderCheck(group.checks[i]));
    sec.appendChild(ul);
    return sec;
  }

  function renderFrequency(freq) {
    var sec = el('section', 'ca-freq');
    sec.appendChild(el('h3', 'ca-group-title', UI().freqTitle));
    sec.appendChild(el('p', 'ca-freq-note', UI().freqNote));

    var tabs = el('div', 'ca-tabs');
    tabs.setAttribute('role', 'tablist');
    var panel = el('div', 'ca-freq-panel');

    var labels = [UI().tab1, UI().tab2, UI().tab3];
    var buttons = [];

    function show(n) {
      for (var b = 0; b < buttons.length; b++) {
        var on = (b + 1) === n;
        buttons[b].classList.toggle('is-active', on);
        buttons[b].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      panel.textContent = '';
      var rows = freq[n] || [];
      if (!rows.length) { panel.appendChild(el('p', 'ca-freq-empty', UI().freqEmpty)); return; }
      var table = el('table', 'ca-freq-table');
      var thead = el('thead');
      var hr = el('tr');
      hr.appendChild(el('th', null, UI().colTerm));
      hr.appendChild(el('th', null, UI().colCount));
      hr.appendChild(el('th', null, UI().colShare));
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el('tbody');
      for (var i = 0; i < rows.length; i++) {
        var tr = el('tr');
        tr.appendChild(el('td', 'ca-freq-term', rows[i].term));
        tr.appendChild(el('td', 'ca-freq-count', String(rows[i].count)));
        tr.appendChild(el('td', 'ca-freq-share', rows[i].share + (LANG === 'fr' ? NBSP : '') + '%'));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      panel.appendChild(table);
    }

    for (var i = 0; i < 3; i++) {
      (function (idx) {
        var btn = el('button', 'ca-tab', labels[idx]);
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('data-cursor', '');
        btn.addEventListener('click', function () { show(idx + 1); });
        buttons.push(btn);
        tabs.appendChild(btn);
      })(i);
    }

    sec.appendChild(tabs);
    sec.appendChild(panel);
    show(1);
    return sec;
  }

  function renderResults(result, container) {
    container.textContent = '';
    container.appendChild(renderRing(result.score, result.grade, result.ran, result.model.words.length, result.model.truncated));
    var groups = el('div', 'ca-groups');
    for (var i = 0; i < result.groups.length; i++) groups.appendChild(renderGroup(result.groups[i]));
    container.appendChild(groups);
    container.appendChild(renderFrequency(result.freq));
  }

  /** Plain-text report for the clipboard. */
  function reportText(result, input) {
    var lines = [];
    lines.push(UI().reportTitle);
    lines.push('');
    lines.push(UI().reportScore({ score: result.score, grade: result.grade }));
    lines.push(UI().reportKeyword({ keyword: input.keyword || '—' }));
    lines.push(UI().reportWords({
      words: result.model.words.length,
      sentences: result.model.sentences.length,
      flesch: result.flesch
    }));
    for (var g = 0; g < result.groups.length; g++) {
      var group = result.groups[g];
      lines.push('');
      lines.push('== ' + group.name + ' ==');
      for (var c = 0; c < group.checks.length; c++) {
        var chk = group.checks[c];
        lines.push('[' + T().status[chk.status].toUpperCase() + '] ' + chk.label);
        lines.push('    ' + chk.detail);
        if (chk.fix) lines.push('    ' + UI().reportFix + chk.fix);
      }
    }
    lines.push('');
    lines.push(UI().reportFooter);
    return lines.join('\n');
  }

  /** navigator.clipboard, with the execCommand fallback for non-secure contexts
   *  and older Safari. Resolves true/false; never throws. */
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  // ---- persistence --------------------------------------------------------
  var STORE_KEY = 'davnoot.ca.v1';

  /* localStorage does not merely return null in Safari's private mode and in
   * "block all cookies" — the property ACCESS itself throws. Every touch is wrapped;
   * a failure here must never stop the tool from working. */
  function saveState(state) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — the tool works fine without it */ }
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearState() {
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* nothing to do */ }
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // =========================================================================
  //  10. BOOT
  // =========================================================================

  function init() {
    var form = $('ca-form');
    if (!form) return; // inert on every page that is not the content analyzer

    var fields = {
      keyword: $('ca-keyword'),
      title: $('ca-title'),
      slug: $('ca-slug'),
      meta: $('ca-meta'),
      content: $('ca-content')
    };
    var results = $('ca-results');
    var empty = $('ca-empty');
    var copyBtn = $('ca-copy');
    var clearBtn = $('ca-clear');
    var sampleBtn = $('ca-sample');
    if (!results || !empty) return;

    var lastResult = null;
    var lastInput = null;

    /* ── THE REVIEW CARD ────────────────────────────────────────────────────
     * The "have a person read this draft" offer under the report. It is hidden in
     * the markup and revealed here the first time a score renders, which is the
     * whole of this file's involvement with it: THE POST LIVES IN script.js, and
     * deliberately — see the note at the top of this file. Nothing below fetches,
     * beacons or stores anything.
     *
     * What has to cross the boundary is only what the engine knows and the DOM does
     * not: the score, the word count, and which checks came back short. script.js
     * reads the five input fields itself, straight from the page, so no copy of the
     * visitor's draft is made here.
     *
     * If the markup is absent (an older cached page, or this file loaded on some
     * future tool page) every one of these is a no-op. */
    var leadCard = $('ca-lead');
    var leadScore = $('ca-lead-score');
    var leadWords = $('ca-lead-words');
    var leadFailed = $('ca-lead-failed');
    var leadT0 = $('ca-lead-t0');

    function publishToReviewCard(result) {
      if (leadScore) leadScore.value = String(result.score);
      if (leadWords) leadWords.value = String(result.model.words.length);
      if (leadFailed) {
        /* Ids, not labels. The labels are per-locale strings from STRINGS above, and
         * storing a French visitor's findings under English wording (or the reverse)
         * would put a claim in the record that nobody made. Warnings ride along with
         * failures because "what is wrong with this draft" is the question the
         * reviewer is answering, and a warning is part of the answer. */
        leadFailed.value = result.checks
          .filter(function (c) { return c.status === 'fail' || c.status === 'warn'; })
          .map(function (c) { return c.id; })
          .join(',');
      }
      if (!leadCard || !leadCard.hidden) return;
      leadCard.hidden = false;
      /* Stamped on REVEAL, not at page load. Someone can spend twenty minutes in
       * the analyzer before this card exists, and the server scores an implausibly
       * short gap between "the form appeared" and "it was submitted". Measuring from
       * load would make every real submission look like a twenty-minute dwell and
       * throw the signal away. */
      if (leadT0) leadT0.value = String(Date.now());
    }

    function readInput() {
      return {
        keyword: fields.keyword ? fields.keyword.value : '',
        title: fields.title ? fields.title.value : '',
        slug: fields.slug ? fields.slug.value : '',
        meta: fields.meta ? fields.meta.value : '',
        content: fields.content ? fields.content.value : ''
      };
    }

    function showEmpty() {
      results.hidden = true;
      results.textContent = '';
      empty.hidden = false;
      if (copyBtn) copyBtn.hidden = true;
      // The offer goes with the report. Leaving it up after Clear would invite
      // somebody to send a draft that is no longer on screen, carrying the score of
      // one they have already replaced.
      if (leadCard) leadCard.hidden = true;
      lastResult = null;
    }

    /* The whole analysis is inside this try/catch on purpose. The reference tool's
     * "c++" crash is not just a bad result — the exception escapes, rendering stops
     * halfway, and the page looks like it ate the user's draft. Here, the worst case
     * is a two-line apology beneath a textarea that still holds every word. */
    function run() {
      var input = readInput();
      try {
        lastInput = input;
        lastResult = analyze(input);
        if (lastResult.ran === 0) { showEmpty(); return; } // nothing measurable yet
        renderResults(lastResult, results);
        results.hidden = false;
        empty.hidden = true;
        if (copyBtn) copyBtn.hidden = false;
        // Offer the human read only now that there is a result to improve on.
        publishToReviewCard(lastResult);
      } catch (err) {
        results.textContent = '';
        results.appendChild(el('p', 'ca-error-title', UI().errorTitle));
        results.appendChild(el('p', 'ca-error-body', UI().errorBody));
        results.hidden = false;
        empty.hidden = true;
        if (copyBtn) copyBtn.hidden = true;
        // No score, so nothing to offer a second opinion on.
        if (leadCard) leadCard.hidden = true;
        lastResult = null;
      }
    }

    // Live analysis, but only once there is something worth analysing: a keyword and
    // 20+ words. Re-rendering the whole panel on the third keystroke is noise.
    var liveRun = debounce(function () {
      var input = readInput();
      if (!input.keyword.trim()) return;
      if (wordsOf(input.content).length < 20) return;
      run();
    }, 400);

    var persist = debounce(function () { saveState(readInput()); }, 400);

    form.addEventListener('submit', function (e) {
      e.preventDefault(); // the form must never navigate
      run();
    });

    form.addEventListener('input', function () {
      persist();
      liveRun();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        Object.keys(fields).forEach(function (k) { if (fields[k]) fields[k].value = ''; });
        clearState();
        showEmpty();
        if (fields.keyword) fields.keyword.focus();
      });
    }

    if (sampleBtn) {
      sampleBtn.addEventListener('click', function () {
        var s = T().sample;
        if (fields.keyword) fields.keyword.value = s.keyword;
        if (fields.title) fields.title.value = s.title;
        if (fields.slug) fields.slug.value = s.slug;
        if (fields.meta) fields.meta.value = s.meta;
        if (fields.content) fields.content.value = s.content;
        saveState(readInput());
        run();
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (!lastResult) return;
        var original = UI().copy;
        copyToClipboard(reportText(lastResult, lastInput)).then(function (ok) {
          copyBtn.textContent = ok ? UI().copied : UI().copyFailed;
          window.setTimeout(function () { copyBtn.textContent = original; }, 2000);
        });
      });
    }

    // Restore the previous session, and analyze straight away if it is complete
    // enough to be worth showing.
    var saved = loadState();
    if (saved) {
      Object.keys(fields).forEach(function (k) {
        if (fields[k] && typeof saved[k] === 'string') fields[k].value = saved[k];
      });
      var restored = readInput();
      if (restored.keyword.trim() && wordsOf(restored.content).length >= 20) run();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
