import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CUSTOM_DOMAIN,
  PagesBuildError,
  assemblePagesBundle,
  buildNotFoundHtml,
  buildRedirectHtml,
  buildRobotsTxt,
  buildSitemapXml,
  extractLocalAssetRefs,
  normalizeCustomDomain,
  rewriteFrontendHtmlForPages,
  rewriteRootWebsiteHtml,
  validateBuiltPagesBundle,
} from "../scripts/pagesLib.mjs";
import { deployPagesBundle, parseDeployArgs } from "../scripts/deploy-pages.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("normalizeCustomDomain accepts valid hostnames and normalizes case/whitespace", () => {
  assert.equal(normalizeCustomDomain("therdal.org"), "therdal.org");
  assert.equal(normalizeCustomDomain("  THERDAL.ORG \n"), "therdal.org");
  assert.equal(normalizeCustomDomain("app.therdal.org"), "app.therdal.org");
  assert.equal(normalizeCustomDomain(null), null);
  assert.equal(normalizeCustomDomain(undefined), null);
  assert.equal(normalizeCustomDomain("   "), null);
});

test("normalizeCustomDomain rejects protocols, paths, ports, and malformed hostnames", () => {
  const invalidInputs = [
    "https://therdal.org",
    "http://therdal.org",
    "therdal.org/website",
    "therdal.org:443",
    "therdal org",
    "-therdal.org",
    "therdal-.org",
    "localhost",
    'therdal.org"><script>alert(1)</script>',
  ];

  for (const bad of invalidInputs) {
    assert.throws(
      () => normalizeCustomDomain(bad),
      (err) => err instanceof PagesBuildError && err.code === "INVALID_DOMAIN",
      `Expected "${bad}" to fail domain validation`
    );
  }
});

test("rewriteRootWebsiteHtml updates ../frontend/ links without altering code blocks", () => {
  const sample = [
    '<a href="../frontend/index.html" class="md-btn">Launch App</a>',
    '<a href="../frontend/index.html#create" class="md-btn">Create a Topic</a>',
    "<pre><code># Interactive App: http://localhost:4173/frontend/\n# ../frontend/ untouched in text</code></pre>",
  ].join("\n");

  const out = rewriteRootWebsiteHtml(sample);
  assert.match(out, /href="\.\/frontend\/index\.html"/);
  assert.match(out, /href="\.\/frontend\/index\.html#create"/);
  assert.match(out, /http:\/\/localhost:4173\/frontend\//);
  assert.match(out, /# \.\.\/frontend\/ untouched in text/);
});

test("rewriteFrontendHtmlForPages maps ../website/ references to root Pages layout", () => {
  const sample = [
    '<link rel="icon" href="../website/assets/favicon.svg?v=2" />',
    '<img src="../website/assets/favicon.svg?v=2" alt="Therdal" />',
    '<a href="../website/index.html">← Protocol Website</a>',
    '<a href="../website/docs.html#direct-voting">Docs</a>',
  ].join("\n");

  const out = rewriteFrontendHtmlForPages(sample);
  assert.match(out, /href="\.\.\/assets\/favicon\.svg\?v=2"/);
  assert.match(out, /src="\.\.\/assets\/favicon\.svg\?v=2"/);
  assert.match(out, /href="\.\.\/index\.html"/);
  assert.match(out, /href="\.\.\/docs\.html#direct-voting"/);
  assert.doesNotMatch(out, /\.\.\/website\//);
});

test("buildRedirectHtml preserves query/hash and escapes HTML attributes", () => {
  const html = buildRedirectHtml({
    target: "../docs.html",
    title: "Therdal <Docs> & Specs",
  });
  assert.match(html, /window\.location\.replace\("\.\.\/docs\.html" \+ window\.location\.search \+ window\.location\.hash\)/);
  assert.match(html, /Therdal &lt;Docs&gt; &amp; Specs/);
});

test("buildRobotsTxt, buildSitemapXml, and buildNotFoundHtml configure therdal.org", () => {
  const robots = buildRobotsTxt({ domain: "therdal.org" });
  assert.match(robots, /Sitemap: https:\/\/therdal\.org\/sitemap\.xml/);

  const robotsNoDomain = buildRobotsTxt({ domain: null });
  assert.doesNotMatch(robotsNoDomain, /Sitemap:/);

  const sitemap = buildSitemapXml({ domain: "therdal.org" });
  assert.match(sitemap, /<loc>https:\/\/therdal\.org\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/therdal\.org\/docs\.html<\/loc>/);
  assert.doesNotMatch(sitemap, /\/frontend\//);

  const notFound = buildNotFoundHtml({ domain: "therdal.org" });
  assert.match(notFound, /404 — Page Not Found/);
  assert.match(notFound, /Launch App · Coming Soon/);
  assert.match(notFound, /therdal\.org/);
});

test("extractLocalAssetRefs ignores external schemes, fragments, and code snippets", () => {
  const html = `
    <link rel="stylesheet" href="./src/material-v11.css?v=18" />
    <a href="#protocol">Section</a>
    <a href="https://github.com/svylabs/therdal">GitHub</a>
    <a href="ethereum:0x122900f6288b51998371ed90E2A424d63Ea9564E@1">Donate</a>
    <code><a href="./nonexistent-in-code-sample.html">Code</a></code>
    <script>var s = '<img src="./fake-in-script.png">';</script>
    <a href="./docs.html#aggregator">Aggregator</a>
  `;
  const refs = extractLocalAssetRefs(html);
  assert.deepEqual(refs, ["./src/material-v11.css", "./docs.html"]);
});

test("assemblePagesBundle builds complete bundle for therdal.org and detects broken links or CNAME tampering", () => {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "therdal-pages-test-"));
  try {
    const summary = assemblePagesBundle({
      repoRoot: REPO_ROOT,
      outDir: tmpOut,
      customDomain: DEFAULT_CUSTOM_DOMAIN,
    });

    assert.equal(summary.domain, "therdal.org");
    assert.ok(summary.htmlFileCount >= 8);
    assert.ok(summary.checkedLinks >= 40);
    assert.equal(fs.readFileSync(path.join(tmpOut, "CNAME"), "utf8"), "therdal.org\n");
    assert.equal(fs.existsSync(path.join(tmpOut, ".nojekyll")), true);

    // Verify all "Launch App" controls are Coming Soon and zero active frontend links exist on homepage/docs
    const builtHome = fs.readFileSync(path.join(tmpOut, "index.html"), "utf8");
    const builtDocs = fs.readFileSync(path.join(tmpOut, "docs.html"), "utf8");
    const builtApp = fs.readFileSync(path.join(tmpOut, "app", "index.html"), "utf8");
    assert.match(builtHome, /Coming Soon/);
    assert.match(builtDocs, /Coming Soon/);
    assert.match(builtApp, /Therdal App is Coming Soon/);
    assert.doesNotMatch(builtHome, /href="[^"]*frontend\//);
    assert.doesNotMatch(builtDocs, /href="[^"]*frontend\//);

    // Verify responsive mobile header menu controls exist on both homepage and docs portal
    assert.match(builtHome, /id="mobileMenuBtn"/);
    assert.match(builtHome, /id="mobileNavMenu"/);
    assert.match(builtDocs, /id="mobileMenuBtn"/);
    assert.match(builtDocs, /id="mobileNavMenu"/);

    // Tamper with CNAME and assert validator catches it
    fs.writeFileSync(path.join(tmpOut, "CNAME"), "wrong-domain.org\n", "utf8");
    assert.throws(
      () => validateBuiltPagesBundle(tmpOut, { expectedDomain: "therdal.org" }),
      (err) => err instanceof PagesBuildError && err.code === "CNAME_MISMATCH"
    );
    fs.writeFileSync(path.join(tmpOut, "CNAME"), "therdal.org\n", "utf8");

    // Inject a broken local link and assert validator catches it
    const docsPath = path.join(tmpOut, "docs.html");
    const originalDocs = fs.readFileSync(docsPath, "utf8");
    fs.writeFileSync(docsPath, originalDocs + '\n<a href="./missing-page.html">Broken</a>', "utf8");
    assert.throws(
      () => validateBuiltPagesBundle(tmpOut, { expectedDomain: "therdal.org" }),
      (err) => err instanceof PagesBuildError && err.code === "BROKEN_LOCAL_LINK"
    );
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test("assemblePagesBundle supports omitting CNAME when customDomain is null", () => {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "therdal-pages-nocname-"));
  try {
    const summary = assemblePagesBundle({
      repoRoot: REPO_ROOT,
      outDir: tmpOut,
      customDomain: null,
    });
    assert.equal(summary.domain, null);
    assert.equal(fs.existsSync(path.join(tmpOut, "CNAME")), false);
    assert.equal(fs.existsSync(path.join(tmpOut, ".nojekyll")), true);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test("parseDeployArgs rejects unsafe branch names", () => {
  assert.throws(() => parseDeployArgs(["--branch", "../evil"]), /Invalid branch name/);
  assert.throws(() => parseDeployArgs(["--branch", "bad branch"]), /Invalid branch name/);
});

test("deployPagesBundle publishes gh-pages to a bare repository and skips no-op re-deploys", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "therdal-deploy-e2e-"));
  const bareRepo = path.join(tmpRoot, "remote.git");
  const distDir = path.join(tmpRoot, "dist");
  const verifyClone = path.join(tmpRoot, "verify-clone");

  try {
    execFileSync("git", ["init", "--bare", bareRepo], { stdio: "ignore" });

    // 1. Initial deployment to `gh-pages`
    const first = deployPagesBundle(
      parseDeployArgs([
        "--repo",
        bareRepo,
        "--dist",
        distDir,
        "--branch",
        "gh-pages",
        "--domain",
        "therdal.org",
      ])
    );
    assert.equal(first.status, "deployed");
    assert.equal(first.domain, "therdal.org");
    assert.equal(first.branch, "gh-pages");

    // Verify pushed gh-pages branch contents in a fresh clone
    execFileSync("git", ["clone", "--branch", "gh-pages", bareRepo, verifyClone], {
      stdio: "ignore",
    });
    assert.equal(fs.readFileSync(path.join(verifyClone, "CNAME"), "utf8"), "therdal.org\n");
    assert.equal(fs.existsSync(path.join(verifyClone, ".nojekyll")), true);
    assert.equal(fs.existsSync(path.join(verifyClone, "index.html")), true);
    assert.equal(fs.existsSync(path.join(verifyClone, "docs.html")), true);
    assert.equal(fs.existsSync(path.join(verifyClone, "404.html")), true);
    assert.equal(fs.existsSync(path.join(verifyClone, "frontend", "index.html")), true);

    // 2. Immediate second deploy with identical bundle is detected as up-to-date
    const second = deployPagesBundle(
      parseDeployArgs([
        "--repo",
        bareRepo,
        "--dist",
        distDir,
        "--branch",
        "gh-pages",
        "--domain",
        "therdal.org",
        "--skip-build",
      ])
    );
    assert.equal(second.status, "up-to-date");
    assert.equal(second.commitSha, first.commitSha);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
