import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  importDependency,
  installDependencies,
  isDependencyAvailable,
  isInstallableName,
  npmInstallCommand,
  setAdapterModulesDir,
} from "../collector/deps.js";

// 2026-09 review, M3: optional adapter dependencies were installed into the
// memory store and could never be loaded from there.

let ROOT: string;
let MODULES: string;

/** Lay out a fake installed CommonJS package the way npm would. */
function fakeInstall(dir: string, name: string, source: string) {
  const pkgDir = path.join(dir, "node_modules", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
  );
  fs.writeFileSync(path.join(pkgDir, "index.js"), source);
}

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-deps-"));
  MODULES = path.join(ROOT, "adapter-modules");
  fs.mkdirSync(MODULES, { recursive: true });
  fs.writeFileSync(path.join(MODULES, "package.json"), "{}");
  setAdapterModulesDir(MODULES);
});

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("resolving optional dependencies", () => {
  it("finds a module shipped with the package", () => {
    expect(isDependencyAvailable("express")).toBe(true);
  });

  it("finds a module installed in the adapter-modules dir, and imports it", async () => {
    fakeInstall(MODULES, "memoria-fake-dep", "module.exports = { hello: 'world' };");
    expect(isDependencyAvailable("memoria-fake-dep")).toBe(true);
    const mod = await importDependency<{ hello: string }>("memoria-fake-dep");
    expect(mod.hello).toBe("world");
  });

  it("reports a missing module as unavailable, and says how to install it", async () => {
    expect(isDependencyAvailable("memoria-not-installed")).toBe(false);
    await expect(importDependency("memoria-not-installed")).rejects.toThrow(/not installed/);
  });
});

describe("installing optional dependencies", () => {
  it("accepts only bare package names (no flags, versions, paths or shell characters)", () => {
    for (const ok of ["imapflow", "googleapis", "@scope/pkg", "a.b_c-d"]) {
      expect(isInstallableName(ok), ok).toBe(true);
    }
    for (const bad of ["-g", "--prefix=/", "a@1.0.0", "a&b", "a b", "a|b", "../x", "A", ""]) {
      expect(isInstallableName(bad), bad).toBe(false);
    }
  });

  it("runs npm's CLI script with the Node binary itself: no shell, no command lookup", () => {
    // On Windows a bare npm.cmd went through cmd.exe, which looks in the
    // current directory (adapter-modules) before PATH.
    const node = path.join(ROOT, "nodejs", "node.exe");
    const cli = path.join(ROOT, "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    const cmd = npmInstallCommand(["imapflow"], "win32", node, (p) => p === cli);
    expect(cmd!.file).toBe(node);
    expect(cmd!.args[0]).toBe(cli);
    expect(Object.keys(cmd!)).not.toContain("shell");
    expect(cmd!.args.at(-1)).toBe("imapflow");
    expect(cmd!.args).toContain("--ignore-scripts");
  });

  it("finds npm under ../lib on POSIX layouts, and never falls back to a Windows lookup", () => {
    const node = "/usr/local/bin/node";
    const posixCli = path.join(
      "/usr/local/bin",
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    expect(npmInstallCommand(["x"], "linux", node, (p) => p === posixCli)?.args[0]).toBe(posixCli);
    expect(npmInstallCommand(["x"], "linux", node, () => false)).toEqual({
      file: "npm",
      args: expect.arrayContaining(["install", "x"]),
    });
    expect(npmInstallCommand(["x"], "win32", "C:\\node\\node.exe", () => false)).toBeNull();
  });

  it("the real Node on this machine has an npm CLI beside it", () => {
    const cmd = npmInstallCommand(["x"]);
    expect(cmd?.file).toBe(process.execPath);
  });

  it("refuses an invalid name without running npm", async () => {
    const r = await installDependencies(["--global"]);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/invalid dependency/);
  });

  it("does nothing when everything is already available", async () => {
    const r = await installDependencies(["express"]);
    expect(r).toEqual({ success: true, message: "All dependencies already installed." });
  });
});

describe("SourceRegistry sees on-demand installs", () => {
  it("reports a source installed once its dependency is in <dataDir>/adapter-modules", async () => {
    const { SourceRegistry } = await import("../collector/registry.js");
    const dataDir = path.join(ROOT, "data");
    const reg = new SourceRegistry(dataDir);
    const gmail = () => reg.listSources().find((s) => s.id === "google-gmail");
    expect(gmail()?.installed).toBe(false);

    const modules = path.join(dataDir, "adapter-modules");
    fs.mkdirSync(modules, { recursive: true });
    fs.writeFileSync(path.join(modules, "package.json"), "{}");
    fakeInstall(modules, "googleapis", "module.exports = { google: {} };");
    expect(gmail()?.installed).toBe(true);
  });
});
