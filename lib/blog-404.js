/* The blog's 404 page. Same chrome as everything else, so a dead link still
 * lands the visitor somewhere on-brand with a route back to the site. */
import { esc, navHtml, footerHtml, LOGO } from './templates.js';

export function render404({ title = 'Post not found' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} — Davnoot</title>
<meta name="robots" content="noindex, follow" />
<link rel="icon" type="image/png" href="/${LOGO}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" />
<link rel="stylesheet" href="/blog.css" />
</head>
<body class="blog-404-page">
<div class="cursor"></div>
<div class="cursor-ring"></div>
${navHtml('blog', '/')}
<main class="blog-empty blog-404">
  <p class="mono-label">404</p>
  <h1>${esc(title)}</h1>
  <p>This post has moved, been unpublished, or never existed.</p>
  <p><a href="/blog" class="btn-primary" data-cursor>Back to the blog →</a></p>
</main>
${footerHtml('blog', '/')}
<script src="/script.js"></script>
</body>
</html>`;
}
