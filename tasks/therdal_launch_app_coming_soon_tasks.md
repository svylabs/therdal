# Disable "Launch App" Links & Display "Coming Soon" Tasks

## Feature Summary
Disable all **"Launch App"** navigation across the Therdal website (`website/index.html`, `website/docs.html`, `index.html`, and the GitHub Pages static bundle `website/dist/`) so that "Launch App" does not open the prototype frontend and instead clearly displays **"Coming Soon"**.

## Architecture
- **Website Pages (`website/index.html`, `website/docs.html`, `index.html`)**:
  - Replace all `<a href="../frontend/index.html">Launch App</a>` anchors in the Top App Bar, Hero section, Closing CTA banner, and Footer with non-navigating `<button type="button" aria-disabled="true" data-coming-soon="true">` controls displaying `Launch App` alongside a crisp `Coming Soon` badge (and `Launch App · Coming Soon` in the footer).
  - Replace secondary `../frontend/index.html#create` links on `website/index.html` with `./docs.html` documentation links, and remove the `./frontend/index.html` shortcut from root `index.html`.
- **Styling & Interactive Feedback (`website/src/material-v11.css`, `website/src/material-v12.js`, `website/src/docs-v10.js`, plus CSS/JS mirrors in `website/src/`)**:
  - Add Material Design 3 disabled/coming-soon button styles (`.md-btn-soon`, `.md-soon-badge`, `.footer-soon-item`) with `cursor: not-allowed` and subtle pulse feedback if clicked, ensuring zero navigation.
  - Synchronize all legacy CSS and JS bundle mirrors in `website/src/` and bump cache-busting query versions (`?v=19` / `?v=16` / `?v=14`).
- **GitHub Pages Static Bundle (`website/scripts/pagesLib.mjs`, `website/test/pages.test.mjs`, `docs/deployment.md`)**:
  - Update `assemblePagesBundle` so `/app/index.html` and `/frontend/index.html` in `website/dist/` render a dedicated dark-themed **"Therdal App — Coming Soon"** page rather than exposing the local Stage 2 test harness on `therdal.org`, remove `/frontend/` from `sitemap.xml`, and update `404.html` and unit tests accordingly.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Replace all `"Launch App"` and `../frontend/` links in `website/index.html`, `website/docs.html`, and root `index.html` with non-navigating `"Coming Soon"` controls | Complete |
| 2 | Add Material Design 3 `"Coming Soon"` badge/disabled styles and non-navigating click feedback in `website/src/material-v11.css`, `website/src/material-v12.js`, `website/src/docs-v10.js`, and synchronize `website/src/` mirrors | Complete |
| 3 | Update `website/scripts/pagesLib.mjs` and `website/test/pages.test.mjs` so `/app/` and `/frontend/` in `website/dist/` serve a `"Coming Soon"` page and verify zero active app links | Complete |
| 4 | Update `docs/deployment.md` and run all test & build suites (`npm run website:test`, `npm run website:build`, `npm run website:deploy:dry-run`) | Complete |
