# Mobile Header Navigation Menu Tasks

## Feature Summary
Add a responsive Material Design 3 mobile navigation menu to the top app bar on both `website/index.html` and `website/docs.html` so all header navigation options (`Protocol`, `Contribute`, `Earn`, `Fees`, `About`, `Docs`, plus `GitHub` and `Launch App · Coming Soon`) are accessible via a clean hamburger menu on mobile and tablet viewports (`<= 960px`) without horizontal overflow.

## Architecture
- **HTML Structure (`website/index.html`, `website/docs.html`)**:
  - Add an accessible mobile menu toggle button (`#mobileMenuBtn`, `aria-expanded="false"`, `aria-controls="mobileNavMenu"`) with hamburger (`☰`) and close (`✕`) SVG states inside `.top-bar-actions`.
  - Add a collapsible Material Design 3 mobile dropdown drawer (`#mobileNavMenu`) inside `<header class="md-top-bar">` containing all 6 primary header navigation links (`Protocol`, `Contribute`, `Earn`, `Fees`, `About`, `Docs`) and a mobile action footer (`GitHub` + `Launch App · Coming Soon`).
- **Responsive Styling (`website/src/material-v11.css` + `website/src/` mirrors)**:
  - At `@media (max-width: 960px)`: hide inline desktop `.md-nav` and show `#mobileMenuBtn`, enabling the smooth glassmorphic `#mobileNavMenu` dropdown panel below the sticky header.
  - At `@media (max-width: 680px)`: hide the wide desktop `.top-bar-actions` pills (`GitHub` and `Launch App · Coming Soon`) from the top bar row (exposing them inside `#mobileNavMenu`) so narrow 320px–430px phone screens never overflow horizontally.
- **Interactive Behavior (`website/src/material-v12.js`, `website/src/docs-v10.js` + `website/src/` mirrors)**:
  - Toggle `is-open` / `hidden` / `aria-expanded` on `#mobileMenuBtn` click.
  - Auto-close the mobile menu when a nav link is selected, when clicking outside `.md-top-bar`, when pressing `Escape`, when resizing above `960px`, or (on `docs.html`) when opening the left documentation topics drawer (`#docsSidebar`).
- **Automated Verification (`website/test/pages.test.mjs`)**:
  - Assert that built `index.html` and `docs.html` include `#mobileMenuBtn` and `#mobileNavMenu` with valid local links.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Add `#mobileMenuBtn` toggle button and `#mobileNavMenu` dropdown panel with all header navigation options to `website/index.html` and `website/docs.html` | Complete |
| 2 | Add responsive Material Design 3 mobile menu styles (`<= 960px` and `<= 680px`) in `website/src/material-v11.css` and synchronize CSS mirrors | Complete |
| 3 | Implement mobile menu toggle, outside-click, Escape, link-selection, resize, and docs-drawer coordination in `website/src/material-v12.js` and `website/src/docs-v10.js` (plus JS mirrors) | Complete |
| 4 | Add mobile menu verification checks in `website/test/pages.test.mjs` and run `npm run website:test` and `npm run website:build` | Complete |
