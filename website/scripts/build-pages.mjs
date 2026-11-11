#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CUSTOM_DOMAIN, assemblePagesBundle } from "./pagesLib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "website", "dist");

function parseBuildArgs(argv) {
  let outDir = DEFAULT_OUT_DIR;
  let customDomain = undefined;
  let noCname = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      outDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--domain" && argv[i + 1] !== undefined) {
      customDomain = argv[i + 1];
      i += 1;
    } else if (arg === "--no-cname") {
      noCname = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node website/scripts/build-pages.mjs [options]

Options:
  --out <dir>       Output directory (default: website/dist)
  --domain <host>   Custom CNAME domain (default: CNAME file or "${DEFAULT_CUSTOM_DOMAIN}")
  --no-cname        Omit CNAME file (useful for *.github.io/<repo>/ subpath previews)
  -h, --help        Show help`);
      process.exit(0);
    } else {
      throw new Error(`Unknown CLI option: ${arg}`);
    }
  }

  let resolvedDomain = customDomain;
  if (noCname) {
    resolvedDomain = null;
  } else if (resolvedDomain === undefined) {
    const repoCnamePath = path.join(REPO_ROOT, "CNAME");
    if (fs.existsSync(repoCnamePath)) {
      resolvedDomain = fs.readFileSync(repoCnamePath, "utf8").trim() || DEFAULT_CUSTOM_DOMAIN;
    } else {
      resolvedDomain = DEFAULT_CUSTOM_DOMAIN;
    }
  }

  return { outDir, customDomain: resolvedDomain };
}

try {
  const { outDir, customDomain } = parseBuildArgs(process.argv.slice(2));
  const summary = assemblePagesBundle({
    repoRoot: REPO_ROOT,
    outDir,
    customDomain,
  });

  console.log(
    `[therdal-pages] Built static GitHub Pages bundle at ${path.relative(REPO_ROOT, summary.outDir) || summary.outDir}`
  );
  console.log(
    `[therdal-pages] Custom domain: ${summary.domain ?? "(none)"} | HTML pages: ${summary.htmlFileCount} | Verified local links: ${summary.checkedLinks}`
  );
} catch (err) {
  console.error(`[therdal-pages] Build failed: ${err.message}`);
  process.exit(1);
}
