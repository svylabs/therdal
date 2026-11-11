import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CUSTOM_DOMAIN = "therdal.org";

export class PagesBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PagesBuildError";
    this.code = code;
  }
}

/**
 * Validates and normalizes a GitHub Pages custom domain (e.g. "therdal.org").
 * Returns `null` when rawDomain is null/undefined/empty (omits CNAME).
 */
export function normalizeCustomDomain(rawDomain) {
  if (rawDomain === null || rawDomain === undefined) {
    return null;
  }
  const trimmed = String(rawDomain).trim().toLowerCase();
  if (trimmed === "") {
    return null;
  }
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(":") || /\s/.test(trimmed)) {
    throw new PagesBuildError(
      "INVALID_DOMAIN",
      `Invalid custom domain "${rawDomain}": expected a bare hostname like "therdal.org" without protocol, port, or path.`
    );
  }
  const hostnamePattern = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!hostnamePattern.test(trimmed)) {
    throw new PagesBuildError(
      "INVALID_DOMAIN",
      `Invalid custom domain "${rawDomain}": must be a valid DNS domain name.`
    );
  }
  return trimmed;
}

/**
 * Rewrites relative cross-directory links when `website/index.html` or `website/docs.html`
 * is promoted to the root of the GitHub Pages static bundle.
 * Only HTML link attributes are modified; documentation code blocks remain intact.
 */
export function rewriteRootWebsiteHtml(html) {
  return String(html).replace(/href="\.\.\/frontend\//g, 'href="./frontend/');
}

/**
 * Rewrites relative cross-directory links inside `frontend/index.html` so they point
 * to the root-level assets, homepage, and documentation portal in the Pages bundle.
 */
export function rewriteFrontendHtmlForPages(html) {
  return String(html)
    .replace(/(href|src)="\.\.\/website\/assets\//g, '$1="../assets/')
    .replace(/href="\.\.\/website\/index\.html/g, 'href="../index.html')
    .replace(/href="\.\.\/website\/docs\.html/g, 'href="../docs.html');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generates a query- and hash-preserving static HTML redirect page for clean aliases
 * (`/app/`, `/docs/`) and backward-compatible `/website/*` URLs.
 */
export function buildRedirectHtml({ target, title, faviconPrefix = "../assets" }) {
  const safeTarget = escapeHtml(target);
  const safeTitle = escapeHtml(title);
  const safeFaviconPrefix = escapeHtml(faviconPrefix);
  const jsonTarget = JSON.stringify(target);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="0; url=${safeTarget}" />
  <meta name="robots" content="noindex" />
  <title>${safeTitle}</title>
  <link rel="icon" type="image/svg+xml" href="${safeFaviconPrefix}/favicon.svg?v=2" />
  <link rel="shortcut icon" href="${safeFaviconPrefix}/favicon.ico?v=2" />
  <script>
    window.location.replace(${jsonTarget} + window.location.search + window.location.hash);
  </script>
</head>
<body style="background:#0d1017;color:#e4e8f2;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;padding:2.5rem;">
  <p>Redirecting to <a href="${safeTarget}" style="color:#aac7ff;">${safeTitle}</a>...</p>
</body>
</html>
`;
}

/**
 * Generates a self-contained GitHub Pages `404.html` page matching Therdal's dark
 * Material Design 3 theme. Styles are inlined so nested 404 routes render cleanly at any URL depth.
 */
export function buildNotFoundHtml({ domain = DEFAULT_CUSTOM_DOMAIN } = {}) {
  const normalized = normalizeCustomDomain(domain);
  const canonicalHome = normalized ? `https://${normalized}/` : "/";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>404 — Page Not Found | Therdal</title>
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=2" />
  <link rel="shortcut icon" href="/favicon.ico" />
  <style>
    :root {
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      background: radial-gradient(circle at 50% 0%, #182338 0%, #0d1017 62%);
      color: #e4e8f2;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      max-width: 520px;
      width: 100%;
      background: #151923;
      border: 1px solid rgba(170, 199, 255, 0.16);
      border-radius: 24px;
      padding: 2.5rem 2rem;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    }
    .code {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      background: rgba(170, 199, 255, 0.12);
      color: #aac7ff;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.75rem;
      font-size: 1.85rem;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 1.75rem;
      color: #9aa5bd;
      line-height: 1.6;
      font-size: 0.98rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: center;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.7rem 1.25rem;
      border-radius: 999px;
      font-weight: 600;
      font-size: 0.92rem;
      text-decoration: none;
      transition: opacity 0.15s ease;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .btn-primary {
      background: #aac7ff;
      color: #0b1b36;
    }
    .btn-secondary {
      background: rgba(170, 199, 255, 0.12);
      color: #d6e3ff;
      border: 1px solid rgba(170, 199, 255, 0.22);
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="code">404 · Not Found</div>
    <h1>Page not found</h1>
    <p>
      The page you requested does not exist on <strong>${escapeHtml(normalized || "Therdal")}</strong>.
      Explore the protocol overview, documentation, or interactive voting app below.
    </p>
    <div class="actions">
      <a href="/" class="btn btn-primary" data-root-link="">Protocol Home</a>
      <a href="/docs.html" class="btn btn-secondary" data-root-link="docs.html">Documentation</a>
      <a href="/frontend/index.html" class="btn btn-secondary" data-root-link="frontend/index.html">Launch App</a>
    </div>
  </main>
  <script>
    (function () {
      if (/\\.github\\.io$/i.test(window.location.hostname)) {
        var segs = window.location.pathname.split("/").filter(Boolean);
        var base = segs.length > 0 ? "/" + segs[0] + "/" : "/";
        document.querySelectorAll("[data-root-link]").forEach(function (a) {
          a.setAttribute("href", base + (a.getAttribute("data-root-link") || ""));
        });
      }
    })();
  </script>
  <!-- Canonical home: ${escapeHtml(canonicalHome)} -->
</body>
</html>
`;
}

export function buildRobotsTxt({ domain = DEFAULT_CUSTOM_DOMAIN } = {}) {
  const normalized = normalizeCustomDomain(domain);
  const lines = ["User-agent: *", "Allow: /"];
  if (normalized) {
    lines.push(`Sitemap: https://${normalized}/sitemap.xml`);
  }
  return lines.join("\n") + "\n";
}

export function buildSitemapXml({ domain = DEFAULT_CUSTOM_DOMAIN } = {}) {
  const normalized = normalizeCustomDomain(domain);
  const base = normalized ? `https://${normalized}` : "https://therdal.org";
  const urls = [`${base}/`, `${base}/docs.html`, `${base}/frontend/`];
  const entries = urls.map((u) => `  <url>\n    <loc>${escapeHtml(u)}</loc>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

/**
 * Extracts local `href` and `src` attribute targets from an HTML document,
 * ignoring external schemes (`https:`, `mailto:`, `ethereum:`, `data:`) and pure `#hash` fragments.
 */
export function extractLocalAssetRefs(html) {
  const refs = [];
  // Strip HTML comments and <script>/<pre>/<code> contents before scanning attributes so sample snippets do not false-trigger.
  const sanitized = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, "");

  const attrRegex = /\b(?:href|src)="([^"]+)"/gi;
  let match;
  while ((match = attrRegex.exec(sanitized)) !== null) {
    const raw = match[1].trim();
    if (
      !raw ||
      raw.startsWith("#") ||
      /^(?:https?:|mailto:|ethereum:|tel:|data:|javascript:|blob:)/i.test(raw) ||
      raw.startsWith("//")
    ) {
      continue;
    }
    const cleanPath = raw.split("#")[0].split("?")[0];
    if (cleanPath) {
      refs.push(cleanPath);
    }
  }
  return refs;
}

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function listHtmlFilesRecursive(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listHtmlFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Assembles a complete, GitHub Pages-ready static directory at `outDir`.
 */
export function assemblePagesBundle({
  repoRoot,
  outDir,
  customDomain = DEFAULT_CUSTOM_DOMAIN,
}) {
  const normalizedDomain = normalizeCustomDomain(customDomain);

  const websiteDir = path.join(repoRoot, "website");
  const frontendDir = path.join(repoRoot, "frontend");
  const requiredSources = [
    path.join(websiteDir, "index.html"),
    path.join(websiteDir, "docs.html"),
    path.join(websiteDir, "assets", "favicon.svg"),
    path.join(websiteDir, "src", "material-v11.css"),
    path.join(websiteDir, "src", "material-v12.js"),
    path.join(websiteDir, "src", "docs-v10.js"),
    path.join(frontendDir, "index.html"),
    path.join(frontendDir, "src", "app.js"),
  ];

  for (const srcFile of requiredSources) {
    if (!fs.existsSync(srcFile)) {
      throw new PagesBuildError("MISSING_SOURCE_FILE", `Required source file not found: ${srcFile}`);
    }
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Root homepage & docs portal
  const rawHomeHtml = fs.readFileSync(path.join(websiteDir, "index.html"), "utf8");
  const rawDocsHtml = fs.readFileSync(path.join(websiteDir, "docs.html"), "utf8");
  fs.writeFileSync(path.join(outDir, "index.html"), rewriteRootWebsiteHtml(rawHomeHtml), "utf8");
  fs.writeFileSync(path.join(outDir, "docs.html"), rewriteRootWebsiteHtml(rawDocsHtml), "utf8");

  // 2. Static assets, favicon, and website CSS/JS bundles
  copyDirRecursive(path.join(websiteDir, "assets"), path.join(outDir, "assets"));
  copyDirRecursive(path.join(websiteDir, "src"), path.join(outDir, "src"));
  fs.copyFileSync(path.join(websiteDir, "assets", "favicon.ico"), path.join(outDir, "favicon.ico"));

  // 3. Interactive Protocol App (`/frontend/`)
  fs.mkdirSync(path.join(outDir, "frontend"), { recursive: true });
  const rawFrontendHtml = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
  fs.writeFileSync(
    path.join(outDir, "frontend", "index.html"),
    rewriteFrontendHtmlForPages(rawFrontendHtml),
    "utf8"
  );
  copyDirRecursive(path.join(frontendDir, "src"), path.join(outDir, "frontend", "src"));

  // 4. Clean route aliases (`/docs/`, `/app/`) & backward-compatible `/website/*` routes
  fs.mkdirSync(path.join(outDir, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "docs", "index.html"),
    buildRedirectHtml({ target: "../docs.html", title: "Therdal Documentation" }),
    "utf8"
  );

  fs.mkdirSync(path.join(outDir, "app"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "app", "index.html"),
    buildRedirectHtml({ target: "../frontend/index.html", title: "Therdal App" }),
    "utf8"
  );

  fs.mkdirSync(path.join(outDir, "website"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "website", "index.html"),
    buildRedirectHtml({ target: "../index.html", title: "Therdal Protocol Website" }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "website", "docs.html"),
    buildRedirectHtml({ target: "../docs.html", title: "Therdal Documentation" }),
    "utf8"
  );

  // 5. GitHub Pages control & metadata files (`.nojekyll`, `CNAME`, `404.html`, `robots.txt`, `sitemap.xml`)
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
  if (normalizedDomain) {
    fs.writeFileSync(path.join(outDir, "CNAME"), `${normalizedDomain}\n`, "utf8");
  }
  fs.writeFileSync(path.join(outDir, "404.html"), buildNotFoundHtml({ domain: normalizedDomain }), "utf8");
  fs.writeFileSync(path.join(outDir, "robots.txt"), buildRobotsTxt({ domain: normalizedDomain }), "utf8");
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), buildSitemapXml({ domain: normalizedDomain }), "utf8");

  return validateBuiltPagesBundle(outDir, { expectedDomain: normalizedDomain });
}

/**
 * Validates that a built GitHub Pages directory contains all required artifacts,
 * matching `CNAME` configuration, and zero broken local `href`/`src` links.
 */
export function validateBuiltPagesBundle(outDir, { expectedDomain = DEFAULT_CUSTOM_DOMAIN } = {}) {
  const normalizedExpected = normalizeCustomDomain(expectedDomain);

  const requiredFiles = [
    "index.html",
    "docs.html",
    "404.html",
    ".nojekyll",
    "favicon.ico",
    "robots.txt",
    "sitemap.xml",
    "assets/favicon.svg",
    "assets/logo-mark.svg",
    "src/material-v11.css",
    "src/material-v12.js",
    "src/docs-v10.js",
    "frontend/index.html",
    "frontend/src/app.js",
    "frontend/src/styles.css",
    "docs/index.html",
    "app/index.html",
    "website/index.html",
    "website/docs.html",
  ];

  for (const rel of requiredFiles) {
    const abs = path.join(outDir, rel);
    if (!fs.existsSync(abs)) {
      throw new PagesBuildError("MISSING_BUNDLE_FILE", `Missing expected output file in bundle: ${rel}`);
    }
  }

  const cnamePath = path.join(outDir, "CNAME");
  if (normalizedExpected) {
    if (!fs.existsSync(cnamePath)) {
      throw new PagesBuildError("CNAME_MISMATCH", `Expected CNAME file for "${normalizedExpected}", but none exists.`);
    }
    const actualCname = fs.readFileSync(cnamePath, "utf8").trim();
    if (actualCname !== normalizedExpected) {
      throw new PagesBuildError(
        "CNAME_MISMATCH",
        `CNAME mismatch: expected "${normalizedExpected}", found "${actualCname}".`
      );
    }
  } else if (fs.existsSync(cnamePath)) {
    throw new PagesBuildError("CNAME_MISMATCH", "Expected no CNAME file when customDomain is null, but CNAME exists.");
  }

  const htmlFiles = listHtmlFilesRecursive(outDir);
  let checkedLinks = 0;

  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, "utf8");
    const refs = extractLocalAssetRefs(html);
    for (const ref of refs) {
      const resolved = ref.startsWith("/")
        ? path.join(outDir, ref.slice(1) || "index.html")
        : path.resolve(path.dirname(htmlFile), ref);

      let targetExists = fs.existsSync(resolved);
      if (targetExists && fs.statSync(resolved).isDirectory()) {
        targetExists = fs.existsSync(path.join(resolved, "index.html"));
      }
      if (!targetExists) {
        const relSource = path.relative(outDir, htmlFile);
        throw new PagesBuildError(
          "BROKEN_LOCAL_LINK",
          `Broken local reference "${ref}" in ${relSource} (resolved to ${resolved})`
        );
      }
      checkedLinks += 1;
    }
  }

  return {
    outDir,
    domain: normalizedExpected,
    htmlFileCount: htmlFiles.length,
    checkedLinks,
  };
}
