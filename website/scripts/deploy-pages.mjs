#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CUSTOM_DOMAIN,
  assemblePagesBundle,
  normalizeCustomDomain,
  validateBuiltPagesBundle,
} from "./pagesLib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DIST_DIR = path.join(REPO_ROOT, "website", "dist");

function runGit(args, cwd, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (allowFailure) {
      return null;
    }
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

function copyBundleFiles(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyBundleFiles(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function parseDeployArgs(argv) {
  const opts = {
    distDir: DEFAULT_DIST_DIR,
    branch: "gh-pages",
    remote: "origin",
    repoUrl: null,
    customDomain: undefined,
    noCname: false,
    skipBuild: false,
    dryRun: false,
    force: false,
    message: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dist" && argv[i + 1]) {
      opts.distDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--branch" && argv[i + 1]) {
      opts.branch = argv[i + 1];
      i += 1;
    } else if (arg === "--remote" && argv[i + 1]) {
      opts.remote = argv[i + 1];
      i += 1;
    } else if (arg === "--repo" && argv[i + 1]) {
      opts.repoUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--domain" && argv[i + 1] !== undefined) {
      opts.customDomain = argv[i + 1];
      i += 1;
    } else if (arg === "--no-cname") {
      opts.noCname = true;
    } else if (arg === "--skip-build") {
      opts.skipBuild = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--force") {
      opts.force = true;
    } else if ((arg === "--message" || arg === "-m") && argv[i + 1]) {
      opts.message = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node website/scripts/deploy-pages.mjs [options]

Builds, validates, and deploys the Therdal static website bundle to GitHub Pages.

Options:
  --branch <name>      Target Git branch (default: gh-pages)
  --remote <name>      Git remote name in workspace (default: origin)
  --repo <url|path>    Explicit target Git repository URL/path (overrides --remote)
  --domain <hostname>  Custom domain written to CNAME (default: CNAME file or "${DEFAULT_CUSTOM_DOMAIN}")
  --no-cname           Omit CNAME file
  --dist <dir>         Bundle directory (default: website/dist)
  --skip-build         Deploy an existing bundle in --dist (still validates links)
  -m, --message <msg>  Custom deployment commit message
  --force              Force-push to target branch
  --dry-run            Build, validate, and stage commit locally without pushing
  -h, --help           Show help`);
      process.exit(0);
    } else {
      throw new Error(`Unknown CLI option: ${arg}`);
    }
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(opts.branch) || opts.branch.includes("..")) {
    throw new Error(`Invalid branch name: "${opts.branch}"`);
  }

  if (opts.noCname) {
    opts.resolvedDomain = null;
  } else if (opts.customDomain !== undefined) {
    opts.resolvedDomain = normalizeCustomDomain(opts.customDomain);
  } else {
    const repoCname = path.join(REPO_ROOT, "CNAME");
    opts.resolvedDomain = fs.existsSync(repoCname)
      ? normalizeCustomDomain(fs.readFileSync(repoCname, "utf8").trim() || DEFAULT_CUSTOM_DOMAIN)
      : DEFAULT_CUSTOM_DOMAIN;
  }

  return opts;
}

export function deployPagesBundle(opts) {
  const summary = opts.skipBuild
    ? validateBuiltPagesBundle(opts.distDir, { expectedDomain: opts.resolvedDomain })
    : assemblePagesBundle({
        repoRoot: REPO_ROOT,
        outDir: opts.distDir,
        customDomain: opts.resolvedDomain,
      });

  const remoteUrl = opts.repoUrl || runGit(["remote", "get-url", opts.remote], REPO_ROOT);
  const headSha = runGit(["rev-parse", "--short", "HEAD"], REPO_ROOT, { allowFailure: true }) || "local";
  const commitMessage =
    opts.message ||
    `Deploy Therdal website (${headSha})${summary.domain ? ` [${summary.domain}]` : ""}`;

  const gitUserName =
    runGit(["config", "user.name"], REPO_ROOT, { allowFailure: true }) || "Therdal Deploy Bot";
  const gitUserEmail =
    runGit(["config", "user.email"], REPO_ROOT, { allowFailure: true }) || "deploy@therdal.org";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "therdal-gh-pages-"));

  try {
    runGit(["init"], tmpDir);
    runGit(["config", "user.name", gitUserName], tmpDir);
    runGit(["config", "user.email", gitUserEmail], tmpDir);
    runGit(["remote", "add", "deploy", remoteUrl], tmpDir);

    let hasExistingRemoteBranch = false;
    if (!opts.dryRun && !opts.force) {
      const lsRemote = runGit(
        ["ls-remote", "--heads", "deploy", `refs/heads/${opts.branch}`],
        tmpDir,
        { allowFailure: true }
      );
      if (lsRemote) {
        const fetched = runGit(
          ["fetch", "--depth=1", "deploy", `refs/heads/${opts.branch}:refs/remotes/deploy/${opts.branch}`],
          tmpDir,
          { allowFailure: true }
        );
        if (fetched !== null) {
          runGit(["checkout", "-B", opts.branch, `refs/remotes/deploy/${opts.branch}`], tmpDir);
          // Clear tracked files in worktree before copying fresh bundle so deleted files are removed
          for (const entry of fs.readdirSync(tmpDir)) {
            if (entry === ".git") continue;
            fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
          }
          hasExistingRemoteBranch = true;
        }
      }
    }

    if (!hasExistingRemoteBranch) {
      runGit(["checkout", "--orphan", opts.branch], tmpDir);
    }

    copyBundleFiles(opts.distDir, tmpDir);
    runGit(["add", "-A", "-f"], tmpDir);

    const trackedFiles = runGit(["ls-files"], tmpDir).split("\n").filter(Boolean);
    if (!trackedFiles.includes(".nojekyll")) {
      throw new Error("Expected .nojekyll to be staged in deployment commit.");
    }
    if (summary.domain && !trackedFiles.includes("CNAME")) {
      throw new Error(`Expected CNAME (${summary.domain}) to be staged in deployment commit.`);
    }

    const status = runGit(["status", "--porcelain"], tmpDir);
    if (!status && hasExistingRemoteBranch) {
      return {
        status: "up-to-date",
        remoteUrl,
        branch: opts.branch,
        domain: summary.domain,
        trackedFileCount: trackedFiles.length,
        commitSha: runGit(["rev-parse", "--short", "HEAD"], tmpDir),
      };
    }

    runGit(["commit", "-m", commitMessage], tmpDir);
    const commitSha = runGit(["rev-parse", "--short", "HEAD"], tmpDir);

    if (opts.dryRun) {
      return {
        status: "dry-run",
        remoteUrl,
        branch: opts.branch,
        domain: summary.domain,
        trackedFileCount: trackedFiles.length,
        commitSha,
      };
    }

    const pushArgs = ["push"];
    if (opts.force || !hasExistingRemoteBranch) {
      pushArgs.push("--force");
    }
    pushArgs.push("deploy", `HEAD:refs/heads/${opts.branch}`);
    runGit(pushArgs, tmpDir);

    return {
      status: "deployed",
      remoteUrl,
      branch: opts.branch,
      domain: summary.domain,
      trackedFileCount: trackedFiles.length,
      commitSha,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  try {
    const opts = parseDeployArgs(process.argv.slice(2));
    const result = deployPagesBundle(opts);

    if (result.status === "dry-run") {
      console.log(
        `[therdal-pages] Dry run complete: staged ${result.trackedFileCount} files on branch "${result.branch}" (commit ${result.commitSha}) -> ${result.remoteUrl}`
      );
      if (result.domain) {
        console.log(`[therdal-pages] Target URL: https://${result.domain}/`);
      }
    } else if (result.status === "up-to-date") {
      console.log(
        `[therdal-pages] Branch "${result.branch}" on ${result.remoteUrl} is already up to date (${result.commitSha}).`
      );
    } else {
      console.log(
        `[therdal-pages] Deployed ${result.trackedFileCount} files (${result.commitSha}) to ${result.remoteUrl} [${result.branch}]`
      );
      if (result.domain) {
        console.log(`[therdal-pages] Live URL: https://${result.domain}/`);
      }
    }
  } catch (err) {
    console.error(`[therdal-pages] Deployment failed: ${err.message}`);
    process.exit(1);
  }
}
