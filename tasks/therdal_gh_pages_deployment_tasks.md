# GitHub Pages Compatibility, Custom Domain (`therdal.org`) & Website Deployment Commands Tasks

## Feature Summary
Make the Therdal protocol website (`website/`) and interactive Stage 1–2 web app (`frontend/`) fully compatible with GitHub Pages under the custom domain **`therdal.org`**, and provide both CLI commands and automated GitHub Actions workflows to build, verify, preview, and deploy the site.

Key capabilities:
1. **GitHub Pages Static Bundle (`website/dist/`)**:
   - Promotes the Therdal homepage (`website/index.html`) and two-pane documentation portal (`website/docs.html`) cleanly to the site root (`https://therdal.org/` and `https://therdal.org/docs.html`), bundles the interactive web app at `https://therdal.org/frontend/` (with clean `/app/` and `/docs/` routes plus `/website/` backward-compatible redirects that preserve URL query strings and `#hash` anchors).
   - Emits `CNAME` (`therdal.org`), `.nojekyll` (bypassing Jekyll processing), a themed Material Design 3 `404.html` fallback page, `robots.txt`, and `sitemap.xml`.
   - Adds canonical URLs and OpenGraph / Twitter metadata for `https://therdal.org` across `website/index.html`, `website/docs.html`, and `frontend/index.html`, plus root `CNAME` and `.nojekyll` for branch-root compatibility.
2. **CLI Build, Verification, Preview & Deploy Commands**:
   - Zero-dependency Node.js scripts (`website/scripts/build-pages.mjs` and `website/scripts/deploy-pages.mjs`) backed by a pure testable domain library (`website/scripts/pagesLib.mjs`).
   - Convenient npm commands from both the repository root (`npm run website:build`, `npm run website:preview`, `npm run website:test`, `npm run website:deploy`, `npm run website:deploy:dry-run`) and `website/` (`npm run build`, `npm run preview`, `npm test`, `npm run deploy`, `npm run deploy:dry-run`).
3. **Automated GitHub Actions Pages Workflow**:
   - `.github/workflows/deploy-pages.yml` builds, tests, and deploys `website/dist/` automatically on pushes to `main` (or manual `workflow_dispatch`) via `actions/upload-pages-artifact` and `actions/deploy-pages`.

## Architecture
- **Pure Pages Build & Validation Domain (`website/scripts/pagesLib.mjs`)**:
  - Pure transformation and verification functions separated from filesystem/process CLI entry points:
    - `normalizeCustomDomain`: Validates hostnames (default `therdal.org`), rejecting protocols, paths, or malformed labels.
    - `rewriteRootWebsiteHtml` & `rewriteFrontendHtmlForPages`: Rewrites relative cross-directory `href`/`src` attributes (`../frontend/` -> `./frontend/`, `../website/` -> `../`) without mutating documentation code blocks.
    - `buildRedirectHtml`, `buildNotFoundHtml`, `buildRobotsTxt`, `buildSitemapXml`: Generates deterministic static routing and metadata artifacts.
    - `assemblePagesBundle` & `validateBuiltPagesBundle`: Builds the complete static tree and verifies every local `href`/`src` asset and page target resolves cleanly.
- **CLI Entry Points (`website/scripts/build-pages.mjs`, `website/scripts/deploy-pages.mjs`)**:
  - `build-pages.mjs`: Builds `website/dist/` and runs bundle link/asset verification.
  - `deploy-pages.mjs`: Builds, validates, commits `website/dist/` to an isolated temporary git worktree/repo for the `gh-pages` branch, and pushes to `origin` (with `--dry-run`, `--branch`, `--remote`, `--domain`, and `--message` flags).
- **CI/CD & Repository Configuration**:
  - Root `CNAME` (`therdal.org`), `.nojekyll`, `package.json`, `.gitignore` (`/website/dist`), and `.github/workflows/deploy-pages.yml`.
- **Documentation (`docs/deployment.md`, `website/docs.html`, `README.md`)**:
  - Synchronized deployment commands, GitHub Pages setup options (GitHub Actions vs. `gh-pages` branch), and `therdal.org` DNS records.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Add GitHub Pages root configuration (`CNAME` for `therdal.org`, `.nojekyll`, `.gitignore`), canonical/OpenGraph metadata across `website/index.html`, `website/docs.html`, and `frontend/index.html`, and hash-preserving root `index.html` redirect | Complete |
| 2 | Implement modular static site builder & bundle validator (`website/scripts/pagesLib.mjs` and `website/scripts/build-pages.mjs`) generating `website/dist/` with `CNAME`, `.nojekyll`, `404.html`, `robots.txt`, `sitemap.xml`, and clean `/`, `/docs/`, `/app/`, `/frontend/`, and `/website/` routes | Complete |
| 3 | Implement `gh-pages` CLI deployment script (`website/scripts/deploy-pages.mjs`), npm scripts in root `package.json` and `website/package.json`, and automated GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) | Complete |
| 4 | Write comprehensive automated tests (`website/test/pages.test.mjs`) covering domain validation, HTML path rewriting, full bundle link integrity, and dry-run `gh-pages` deployment | Complete |
| 5 | Synchronize documentation in `docs/deployment.md`, `website/docs.html` (`#quickstart`), and `README.md` with website build/deploy commands and `therdal.org` DNS setup, and run all test suites | Complete |
