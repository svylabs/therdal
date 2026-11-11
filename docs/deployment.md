# Website & GitHub Pages Deployment (`therdal.org`)

The Therdal protocol website (`website/`) and interactive Stage 1–2 web app (`frontend/`) compile into a deterministic, zero-dependency static bundle (`website/dist/`) designed for hosting on **GitHub Pages** under the custom domain **`therdal.org`**.

---

## 1. Static Bundle Layout (`website/dist/`)

Running `npm run website:build` assembles and validates `website/dist/`:

| Output Path | Live URL (`therdal.org`) | Description |
| --- | --- | --- |
| `index.html` | `https://therdal.org/` | Protocol homepage (Material Design 3 dark theme) |
| `docs.html` | `https://therdal.org/docs.html` | Two-pane protocol & operator documentation portal |
| `docs/index.html` | `https://therdal.org/docs/` | Clean alias redirecting to `/docs.html` (preserves `#hash`) |
| `frontend/` | `https://therdal.org/frontend/` | Interactive Stage 1–2 Topic Registry & Direct Snapshot Voting app |
| `app/index.html` | `https://therdal.org/app/` | Clean alias redirecting to `/frontend/index.html` (preserves `#hash`) |
| `website/*` | `https://therdal.org/website/*` | Backward-compatible redirects to `/` and `/docs.html` |
| `CNAME` | `therdal.org` | Custom domain declaration for GitHub Pages |
| `.nojekyll` | — | Disables Jekyll processing on GitHub Pages |
| `404.html` | — | Custom dark-themed 404 fallback page |
| `robots.txt` / `sitemap.xml` | `https://therdal.org/sitemap.xml` | Search engine indexing & canonical sitemap |

Every build automatically validates that `CNAME` matches the expected hostname and that every local `href` / `src` reference across all HTML files resolves to an existing asset.

---

## 2. CLI Commands

From the repository root:

```bash
# Build & validate the static GitHub Pages bundle in website/dist/
npm run website:build

# Build & preview the production Pages bundle locally at http://localhost:4173
npm run website:preview

# Run unit & bundle integrity tests (domain checks, link rewrites, bare-repo deploy test)
npm run website:test

# Dry-run deployment (builds, validates, and stages the gh-pages commit locally without pushing)
npm run website:deploy:dry-run

# Build, validate, and deploy website/dist/ to the `gh-pages` branch on `origin`
npm run website:deploy
```

Equivalent commands are also available directly inside `website/`:

```bash
cd website
npm run build
npm run preview
npm test
npm run deploy:dry-run
npm run deploy
```

### Advanced CLI Flags (`website/scripts/deploy-pages.mjs`)

```bash
# Deploy to a custom remote or branch
node website/scripts/deploy-pages.mjs --remote origin --branch gh-pages

# Build without CNAME (e.g. for previewing on https://<org>.github.io/<repo>/)
node website/scripts/build-pages.mjs --no-cname
```

---

## 3. GitHub Pages Configuration (`svylabs/therdal`)

You can host `therdal.org` via either **GitHub Actions** (recommended automatic CI/CD) or the **`gh-pages` branch**:

### Option A: Automatic Deployment via GitHub Actions (Recommended)
1. In GitHub repository **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
2. Pushing changes to `main` (or triggering **Actions → Deploy Therdal Website to GitHub Pages → Run workflow**) automatically runs `.github/workflows/deploy-pages.yml`, executes `npm run website:test` and `npm run website:build`, and deploys `website/dist/`.

### Option B: CLI Branch Deployment (`gh-pages`)
1. Run `npm run website:deploy` locally to publish `website/dist/` to `origin/gh-pages`.
2. In GitHub repository **Settings → Pages → Build and deployment**, set **Source** to **Deploy from a branch**, select **`gh-pages`** and **`/ (root)`**, and click **Save**.

---

## 4. Custom Domain DNS Setup (`therdal.org`)

Configure the following DNS records at your domain registrar for `therdal.org`:

| Type | Host / Name | Value / Target |
| --- | --- | --- |
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |
| `AAAA` | `@` | `2606:50c0:8000::153` |
| `AAAA` | `@` | `2606:50c0:8001::153` |
| `AAAA` | `@` | `2606:50c0:8002::153` |
| `AAAA` | `@` | `2606:50c0:8003::153` |
| `CNAME` | `www` | `svylabs.github.io.` |

Once DNS propagates, verify **Custom domain** is set to `therdal.org` in **Settings → Pages** and check **Enforce HTTPS**.
