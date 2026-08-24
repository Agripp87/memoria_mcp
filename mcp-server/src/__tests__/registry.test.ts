import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { SourceRegistry } from "../collector/registry.js";
import type { CustomSourceDefinition } from "../collector/adapters/custom.js";

let root: string;
let dataDir: string;
let reg: SourceRegistry;

function def(over: Partial<CustomSourceDefinition>): CustomSourceDefinition {
  return {
    id: "src",
    name: "Source",
    description: "desc",
    mode: "file_watcher",
    ...over,
  } as CustomSourceDefinition;
}

beforeEach(() => {
  delete process.env.MEMORIA_ALLOW_SHELL_SOURCES;
  delete process.env.MEMORIA_FILE_WATCHER_ROOTS;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-reg-"));
  dataDir = path.join(root, "data");
  reg = new SourceRegistry(dataDir, root); // constructor inits the master key
});

afterEach(() => {
  delete process.env.MEMORIA_ALLOW_SHELL_SOURCES;
  delete process.env.MEMORIA_FILE_WATCHER_ROOTS;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});

describe("SourceRegistry.addCustomSource gating", () => {
  it("refuses shell_command sources unless MEMORIA_ALLOW_SHELL_SOURCES=true", () => {
    const r = reg.addCustomSource(def({ id: "sh", mode: "shell_command", command: "echo hi" }));
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/shell_command/i);
  });

  it("allows shell_command when explicitly opted in", () => {
    process.env.MEMORIA_ALLOW_SHELL_SOURCES = "true";
    const r = reg.addCustomSource(def({ id: "sh2", mode: "shell_command", command: "echo hi" }));
    expect(r.success).toBe(true);
  });

  it("refuses webhook sources (not implemented — would be a silent no-op)", () => {
    const r = reg.addCustomSource(def({ id: "wh", mode: "webhook", webhookPath: "/wh" }));
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/webhook/i);
  });

  it("refuses a file_watcher pointed at the collector key/credential dir", () => {
    const r = reg.addCustomSource(
      def({ id: "leak", mode: "file_watcher", watchPath: path.join(dataDir, "collector.key") }),
    );
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/collector data directory/i);
  });

  it("denies a file_watcher by default (no MEMORIA_FILE_WATCHER_ROOTS)", () => {
    const wp = path.join(root, "exports.json");
    fs.writeFileSync(wp, "{}");
    const r = reg.addCustomSource(def({ id: "nodefault", mode: "file_watcher", watchPath: wp }));
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/disabled by default|allowlist/i);
  });

  it("accepts a well-formed file_watcher when it is inside an allowed root", () => {
    process.env.MEMORIA_FILE_WATCHER_ROOTS = root;
    const wp = path.join(root, "exports.json");
    fs.writeFileSync(wp, "{}");
    const r = reg.addCustomSource(def({ id: "ok", mode: "file_watcher", watchPath: wp }));
    expect(r.success).toBe(true);
  });

  it("rejects an invalid source id", () => {
    const r = reg.addCustomSource(def({ id: "Bad Id!", mode: "file_watcher", watchPath: root }));
    expect(r.success).toBe(false);
  });
});

describe("SourceRegistry.enableSource consent gate", () => {
  it("refuses to enable a source without recorded user agreement", async () => {
    // imessage is macOS-only; on other platforms enableSource rejects on
    // platform first, so use platform-agnostic assertions: either way it must
    // NOT succeed without consent.
    const r = await reg.enableSource("email");
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/agreement|not available/i);
  });
});
