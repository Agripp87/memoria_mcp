/**
 * Optional collector-adapter dependencies (imapflow, googleapis): where they
 * are installed and how adapters load them.
 *
 * They are not in package.json, since most users never enable a source that
 * needs them, so enabling one installs them on demand into
 * <dataDir>/adapter-modules. That directory belongs to the server: it is not
 * the memory store (a synced, often git-tracked folder of Markdown, where the
 * old installer put a package.json and node_modules), and not the installed
 * package (read-only under a global install, replaced on every upgrade).
 *
 * Until 2026-09 this was broken three ways: the installer ran in the memory
 * store; the "is it installed?" check used `require` in an ES module, which is
 * a ReferenceError its catch swallowed; and adapters imported by bare name,
 * which resolves from the package, so a module installed anywhere else was
 * never found. On Windows the install itself failed, because npm is npm.cmd.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let modulesDir: string | null = null;

/** Set where on-demand adapter dependencies are installed and looked up. */
export function setAdapterModulesDir(dir: string): void {
  modulesDir = dir;
}

const requireFromPackage = createRequire(import.meta.url);

function resolveInModulesDir(name: string): string | null {
  if (!modulesDir) return null;
  try {
    return createRequire(path.join(modulesDir, "package.json")).resolve(name);
  } catch {
    return null;
  }
}

/** Whether `name` can be loaded: shipped with the package, or installed on demand. */
export function isDependencyAvailable(name: string): boolean {
  try {
    requireFromPackage.resolve(name);
    return true;
  } catch {
    return resolveInModulesDir(name) !== null;
  }
}

/**
 * Import an optional dependency: from the package's own node_modules if it is
 * there (a Docker image can bake it in), else from the adapter-modules dir.
 */
export async function importDependency<T>(name: string): Promise<T> {
  try {
    return await import(name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw err;
  }
  const resolved = resolveInModulesDir(name);
  if (!resolved) {
    throw new Error(
      `Optional dependency "${name}" is not installed. Enable the source again ` +
        `(dashboard or memory_sources) to install it.`,
    );
  }
  return (await import(pathToFileURL(resolved).href)) as T;
}

// Bare package names only: no versions, paths, URLs or flags. Adapters declare
// their dependencies in code, so nothing user-supplied reaches this. It also
// has to be shell-safe: on Windows npm is npm.cmd, which Node refuses to spawn
// without a shell (CVE-2024-27980), so there the arguments pass through
// cmd.exe, and this pattern admits no character cmd.exe treats specially.
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function isInstallableName(name: string): boolean {
  return PACKAGE_NAME.test(name);
}

/** The npm invocation that installs `names` into the current directory. */
export function npmInstallCommand(
  names: string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; shell: boolean } {
  // --ignore-scripts: imapflow and googleapis need no install scripts, and
  // without them installing runs no package code at all.
  const args = ["install", "--save", "--ignore-scripts", "--no-audit", "--no-fund", ...names];
  // Through a shell, pass one command string: Node deprecates (DEP0190) an
  // argument array with shell: true, since it is concatenated unescaped
  // anyway. Every part here is a fixed flag or a name isInstallableName
  // passed, so the joined string is safe for cmd.exe.
  return platform === "win32"
    ? { file: ["npm.cmd", ...args].join(" "), args: [], shell: true }
    : { file: "npm", args, shell: false };
}

/**
 * Install whichever of `names` are not yet available into the adapter-modules
 * directory. Asynchronous, so a slow install (googleapis is large) does not
 * freeze the server while it runs.
 */
export async function installDependencies(
  names: string[],
): Promise<{ success: boolean; message: string }> {
  const missing = names.filter((n) => !isDependencyAvailable(n));
  if (missing.length === 0) {
    return { success: true, message: "All dependencies already installed." };
  }
  const invalid = missing.filter((n) => !isInstallableName(n));
  if (invalid.length > 0) {
    return {
      success: false,
      message: `Refusing to install invalid dependency name(s): ${invalid.join(", ")}`,
    };
  }
  if (!modulesDir) {
    return { success: false, message: "No adapter-modules directory is configured." };
  }

  // A package.json of its own makes npm install here, instead of walking up
  // to the nearest ancestor project.
  fs.mkdirSync(modulesDir, { recursive: true });
  const manifest = path.join(modulesDir, "package.json");
  if (!fs.existsSync(manifest)) {
    fs.writeFileSync(
      manifest,
      JSON.stringify(
        {
          name: "memoria-adapter-modules",
          private: true,
          description: "Optional dependencies installed by Memoria's collector sources.",
        },
        null,
        2,
      ) + "\n",
    );
  }

  process.stderr.write(`Memoria: installing adapter dependencies: ${missing.join(", ")}\n`);
  const { file, args, shell } = npmInstallCommand(missing);
  try {
    await execFileAsync(file, args, {
      cwd: modulesDir,
      shell,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return { success: true, message: `Installed: ${missing.join(", ")}` };
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    return {
      success: false,
      message: `npm install failed: ${String(e.stderr || e.message).slice(0, 300)}`,
    };
  }
}
