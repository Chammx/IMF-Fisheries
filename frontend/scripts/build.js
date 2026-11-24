import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');

function requiredOrigin(value, label) {
  if (!value) throw new Error(`${label} must be configured before building the frontend.`);
  try {
    const parsed = new URL(value.startsWith('https://') ? value : `https://${value}`);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !['', '/'].includes(parsed.pathname)
    ) {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin without credentials or a path.`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

requiredOrigin(process.env.IMF_API_URL?.trim(), 'IMF_API_URL');
const rawSiteUrl = process.env.SITE_URL?.trim()
  || process.env.VERCEL_PROJECT_PRODUCTION_URL
  || process.env.VERCEL_URL;
const siteUrl = requiredOrigin(rawSiteUrl, 'SITE_URL');
const index = await readFile(path.join(root, 'index.html'), 'utf8');
const admin = await readFile(path.join(root, 'admin.html'), 'utf8');
const { products: catalog } = await import(pathToFileURL(path.join(root, 'products.js')));
if (
  !Array.isArray(catalog)
  || catalog.length === 0
  || catalog.some((product) => (
    !/^[a-z0-9-]+$/.test(product.slug)
    || !product.name
    || !product.description
    || !Array.isArray(product.specifications)
  ))
) {
  throw new Error('The product catalogue contains invalid SEO page data.');
}

const catalogSlugs = new Set(catalog.map((product) => product.slug));
const builtProductLinks = index.replace(
  /href="\.\/product\.html\?product=([a-z0-9-]+)"/g,
  (match, slug) => {
    if (!catalogSlugs.has(slug)) throw new Error(`Homepage links to unknown product "${slug}".`);
    return `href="./products/${slug}"`;
  },
);
const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'IMF Fisheries',
  url: `${siteUrl}/`,
  description: 'India-based specialist crab export business serving international B2B buyer enquiries for mud crab and blue swimming crab.',
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Mangaluru',
    addressRegion: 'Karnataka',
    addressCountry: 'IN',
  },
};
const seoTags = [
  `<link rel="canonical" href="${siteUrl}/">`,
  `<meta property="og:url" content="${siteUrl}/">`,
  `<script type="application/ld+json">${jsonForHtml(organization)}</script>`,
].join('\n');
const builtIndex = builtProductLinks.replace('<!-- SEO_BUILD_TAGS -->', seoTags);
if (builtIndex === builtProductLinks) throw new Error('The SEO build marker is missing from index.html.');

const productPages = catalog.map((product) => {
  const canonicalUrl = `${siteUrl}/products/${product.slug}`;
  const title = `${product.name} Export Enquiry | IMF Fisheries`;
  const description = product.description;
  const specs = product.specifications.map(([label, value]) => (
    `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  )).join('');
  const about = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonicalUrl,
    about: { '@type': 'Thing', name: product.name },
    isPartOf: { '@type': 'WebSite', name: 'IMF Fisheries', url: `${siteUrl}/` },
  };
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <link rel="canonical" href="${canonicalUrl}">
  <script type="application/ld+json">${jsonForHtml(about)}</script>
  <style>
    :root{color-scheme:light;--bg:#f4f1ea;--ink:#10262e;--mute:#5d6e73;--sea:#0d2b36;--sand:#d8c39a;--card:#fffdf8;--line:rgba(16,38,46,.14);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}main{max-width:900px;margin:auto;padding:clamp(24px,6vw,72px) 20px}
    a{color:inherit}.brand{font-family:Georgia,serif;font-size:26px;text-decoration:none}.eyebrow{margin-top:54px;color:var(--mute);font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
    h1,h2{font-family:Georgia,serif;font-weight:400;line-height:1.04}h1{font-size:clamp(46px,8vw,88px);margin:12px 0 20px}h2{font-size:34px;margin-top:48px}
    p{max-width:720px}.summary{font-size:19px;color:var(--mute)}.facts{width:100%;border-collapse:collapse;background:var(--card);border-radius:16px;overflow:hidden}
    th,td{padding:14px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{width:35%}tr:last-child th,tr:last-child td{border-bottom:0}
    .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.button{display:inline-block;padding:13px 20px;border-radius:99px;background:var(--sand);color:#2a2112;text-decoration:none;font-weight:700}
    .button.secondary{border:1px solid var(--ink);background:transparent;color:var(--ink)}.note{margin-top:26px;color:var(--mute);font-size:14px}
    @media(max-width:600px){th,td{padding:12px 10px}th{width:42%}}
  </style>
</head>
<body>
  <main>
    <a class="brand" href="/">IMF Fisheries</a>
    <p class="eyebrow">Seafood export enquiries · India</p>
    <h1>${escapeHtml(product.name)}</h1>
    <p class="summary">${escapeHtml(description)}</p>
    <h2>Buyer specification checklist</h2>
    <p>These are enquiry prompts, not claims of stocked ranges or fixed product specifications. Confirm all details for the requested lot before any offer or order.</p>
    <table class="facts"><tbody>${specs}</tbody></table>
    <div class="actions">
      <a class="button" href="/?product=${encodeURIComponent(product.slug)}#contact">Request a quotation</a>
      <a class="button secondary" href="/#seafood">View all product categories</a>
    </div>
    <p class="note">IMF Fisheries · Mangaluru, Karnataka, India. Certifications, destination-market approvals, availability, logistics and shipping terms are confirmed only when applicable to a specific transaction.</p>
  </main>
</body>
</html>`;
  return { slug: product.slug, html };
});

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true }),
  writeFile(path.join(output, 'index.html'), builtIndex),
  writeFile(path.join(output, 'admin.html'), admin),
  writeFile(path.join(output, 'products.js'), await readFile(path.join(root, 'products.js'))),
  writeFile(
    path.join(output, 'config.js'),
    'window.IMF_API_URL = "";\n',
  ),
  writeFile(
    path.join(output, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
  ),
  writeFile(
    path.join(output, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
      `${siteUrl}/`,
      ...catalog.map((product) => `${siteUrl}/products/${product.slug}`),
    ].map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join('\n')}\n</urlset>\n`,
  ),
  ...productPages.map(async ({ slug, html }) => {
    const directory = path.join(output, 'products', slug);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'index.html'), html);
  }),
]);

console.log(`Built ${productPages.length} product SEO pages for ${siteUrl}`);
