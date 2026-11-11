# Therdal Brand Logo & Favicon Tasks

## Feature Summary
Design and integrate an original geometric brand logo and multi-format favicon suite for **Therdal** (*The voice of ETH holders — A permissionless and verifiable stakeholder signaling protocol for Ethereum*).

## Architecture
- **Visual Concept ("Signal Wedge — Half-ETH V + Wi-Fi Cone")**:
  - Uses only the **faceted lower `V`-chevron half** of the Ethereum mark at the base (`(32, 50.5)` apex, `#E4EEFF` / `#AAC7FF` left facet and `#AAC7FF` / `#6CA0F8` right facet) aligned along exact `±36°` rays with **two concentric upward Wi-Fi signal arcs** (`R=24.5` in `#AAC7FF` and `R=34.0` in `#7DD8B6`), forming a single unified Wi-Fi broadcast wedge without using the full Ethereum octahedron.
- **Asset Suite (`website/assets/`)**:
  - `logo-mark.svg`: Transparent-background geometric symbol for top app bars, footer, and UI badges.
  - `logo-lockup.svg`: Full horizontal brand lockup combining the Signal Prism badge and `Therdal` wordmark (used in `README.md` and brand references).
  - `favicon.svg`: Scalable vector favicon enclosed in a deep tonal navy-slate squircle (`#182744` → `#0E1522`).
  - `favicon-32x32.png`, `apple-touch-icon.png` (`180x180`), and `favicon.ico` (`16x16` + `32x32` ICO container) for universal browser compatibility.
- **Integration Points**:
  - `website/index.html` & `website/docs.html`: Favicon `<link>` tags + custom Signal Prism SVG in `.md-brand` (header and footer).
  - `frontend/index.html` & root `index.html`: Favicon `<link>` tags + updated topbar brand badge in `frontend/index.html`.
  - `README.md`: Embedded `website/assets/logo-lockup.svg` header lockup.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Create `website/assets/logo-mark.svg`, `website/assets/logo-lockup.svg`, and `website/assets/favicon.svg` | Complete |
| 2 | Render raster favicons (`favicon-32x32.png`, `apple-touch-icon.png`, and multi-size `favicon.ico`) in `website/assets/` | Complete |
| 3 | Update `website/index.html`, `website/docs.html`, `frontend/index.html`, `index.html`, `website/src/material-v11.css`, and `README.md` with the new logo and favicon links | Complete |
| 4 | Visually inspect rendered logo assets and navbar header via headless screenshot verification | Complete |
