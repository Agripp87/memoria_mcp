/**
 * Source Registry — manages available and enabled data sources.
 *
 * Features:
 *   - Select/deselect data sources
 *   - Add custom sources (user-defined)
 *   - Auto-install npm dependencies when a source is enabled
 *   - Persist configuration (encrypted)
 *   - User agreement flow before enabling any source
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { SourceAdapter, AdapterInfo, AdapterConfig } from "./adapters/base.js";
import { IMessageAdapter } from "./adapters/imessage.js";
import { CalendarAdapter } from "./adapters/calendar.js";
import { EmailAdapter } from "./adapters/email.js";
import { GoogleGmailAdapter } from "./adapters/google-gmail.js";
import { GoogleCalendarAdapter } from "./adapters/google-calendar.js";
import { GoogleDriveAdapter } from "./adapters/google-drive.js";
import {
  CustomAdapter,
  assertWatchPathAllowed,
  type CustomSourceDefinition,
} from "./adapters/custom.js";
import { encryptJSON, decryptJSON, initMasterKey } from "./crypto.js";

// ── Types ──────────────────────────────────────────────────

export interface SourceStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  installed: boolean;
  platforms: string[];
  requiredPermissions: string[];
  builtIn: boolean;
  eventCount: number;
  lastPoll: string | null;
  error: string | null;
}

export interface UserAgreement {
  agreedAt: string;
  sources: string[];
  version: number;
}

interface RegistryState {
  configs: Record<string, AdapterConfig>;
  checkpoints: Record<string, string>;
  customSources: CustomSourceDefinition[];
  agreement: UserAgreement | null;
  eventCounts: Record<string, number>;
}

// ── Registry ───────────────────────────────────────────────

export class SourceRegistry {
  private adapters = new Map<string, SourceAdapter>();
  private activeAdapters = new Map<string, SourceAdapter>();
  private state: RegistryState;
  private configPath: string;
  private projectDir: string;
  private dataDir: string;
  private errors = new Map<string, string>();
  private lastPolled = new Map<string, string>();

  constructor(dataDir: string, projectDir: string) {
    this.configPath = path.join(dataDir, "collector-config.enc");
    this.projectDir = projectDir;
    this.dataDir = dataDir;

    // Init encryption
    initMasterKey(dataDir);

    // Register built-in adapters
    this.registerBuiltIn(new IMessageAdapter());
    this.registerBuiltIn(new CalendarAdapter());
    this.registerBuiltIn(new EmailAdapter());
    this.registerBuiltIn(new GoogleGmailAdapter());
    this.registerBuiltIn(new GoogleCalendarAdapter());
    this.registerBuiltIn(new GoogleDriveAdapter());

    // Load persisted state
    this.state = this.loadState();

    // Re-register custom sources from state
    for (const def of this.state.customSources) {
      this.adapters.set(`custom-${def.id}`, new CustomAdapter(def, { dataDir }));
    }
  }

  // ── Built-in registration ────────────────────────────────

  private registerBuiltIn(adapter: SourceAdapter): void {
    this.adapters.set(adapter.info.id, adapter);
  }

  // ── Source listing and selection ──────────────────────────

  /**
   * List all available sources with their status.
   */
  listSources(): SourceStatus[] {
    const statuses: SourceStatus[] = [];

    for (const [id, adapter] of this.adapters) {
      const config = this.state.configs[id] ?? adapter.info.defaultConfig;
      const depsInstalled = this.checkDependencies(adapter.info.dependencies);

      statuses.push({
        id,
        name: adapter.info.name,
        description: adapter.info.description,
        enabled: config.enabled,
        installed: depsInstalled,
        platforms: adapter.info.platforms,
        requiredPermissions: adapter.info.requiredPermissions,
        builtIn: adapter.info.builtIn,
        eventCount: this.state.eventCounts[id] ?? 0,
        lastPoll: this.lastPolled.get(id) ?? null,
        error: this.errors.get(id) ?? null,
      });
    }

    return statuses;
  }

  /**
   * Enable a data source. Requires user agreement.
   * Auto-installs dependencies if needed.
   */
  async enableSource(
    sourceId: string,
    configOverrides?: Partial<AdapterConfig>
  ): Promise<{ success: boolean; message: string }> {
    const adapter = this.adapters.get(sourceId);
    if (!adapter) {
      return { success: false, message: `Unknown source: ${sourceId}` };
    }

    // Check platform compatibility
    const platformMap: Record<string, string> = {
      darwin: "macos",
      linux: "linux",
      win32: "windows",
    };
    const currentPlatform = platformMap[process.platform] || process.platform;
    if (
      adapter.info.platforms.length > 0 &&
      !adapter.info.platforms.includes(currentPlatform as typeof adapter.info.platforms[number])
    ) {
      return {
        success: false,
        message:
          `Source "${adapter.info.name}" is not available on ${currentPlatform}. ` +
          `Supported platforms: ${adapter.info.platforms.join(", ")}`,
      };
    }

    // Check user agreement
    if (!this.hasAgreement(sourceId)) {
      return {
        success: false,
        message:
          `User agreement required before enabling "${adapter.info.name}". ` +
          `This source will collect: ${adapter.info.description} ` +
          `Permissions needed: ${adapter.info.requiredPermissions.join(", ") || "none"}. ` +
          `All collected data is encrypted (AES-256-GCM). Only you and the Memoria agent have access. ` +
          `Call memory_sources with action "agree" and source "${sourceId}" to consent.`,
      };
    }

    // Re-validate file_watcher containment at enable time (a definition may
    // have been persisted before the guard existed, or the allowlist may have
    // tightened since it was added).
    const customDef = this.state.customSources.find(
      (d) => `custom-${d.id}` === sourceId
    );
    if (customDef?.mode === "file_watcher") {
      try {
        assertWatchPathAllowed(customDef.watchPath ?? "", { dataDir: this.dataDir });
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    }

    // Auto-install dependencies
    if (adapter.info.dependencies.length > 0) {
      const installResult = await this.installDependencies(
        adapter.info.dependencies
      );
      if (!installResult.success) {
        return {
          success: false,
          message: `Failed to install dependencies: ${installResult.message}`,
        };
      }
    }

    // Merge config
    const config: AdapterConfig = {
      ...adapter.info.defaultConfig,
      ...this.state.configs[sourceId],
      ...configOverrides,
      enabled: true,
    };
    this.state.configs[sourceId] = config;

    // Initialize adapter
    try {
      // Restore checkpoint
      const savedCheckpoint = this.state.checkpoints[sourceId];
      if (savedCheckpoint) {
        adapter.setCheckpoint(savedCheckpoint);
      }

      await adapter.init(config);
      this.activeAdapters.set(sourceId, adapter);
      this.errors.delete(sourceId);
      this.saveState();

      return {
        success: true,
        message: `Source "${adapter.info.name}" enabled and collecting.`,
      };
    } catch (err: any) {
      this.errors.set(sourceId, err.message);
      return {
        success: false,
        message: `Failed to initialize "${adapter.info.name}": ${err.message}`,
      };
    }
  }

  /**
   * Disable a data source.
   */
  async disableSource(
    sourceId: string
  ): Promise<{ success: boolean; message: string }> {
    const adapter = this.activeAdapters.get(sourceId);
    if (adapter) {
      // Save checkpoint before stopping
      this.state.checkpoints[sourceId] = adapter.getCheckpoint();
      await adapter.destroy();
      this.activeAdapters.delete(sourceId);
    }

    if (this.state.configs[sourceId]) {
      this.state.configs[sourceId].enabled = false;
    }

    this.saveState();
    return {
      success: true,
      message: `Source "${sourceId}" disabled.`,
    };
  }

  /**
   * Update configuration for a source.
   */
  updateSourceConfig(
    sourceId: string,
    settings: Record<string, unknown>
  ): { success: boolean; message: string } {
    const adapter = this.adapters.get(sourceId);
    if (!adapter) {
      return { success: false, message: `Unknown source: ${sourceId}` };
    }

    const existing = this.state.configs[sourceId] ?? adapter.info.defaultConfig;
    this.state.configs[sourceId] = {
      ...existing,
      settings: { ...existing.settings, ...settings },
    };

    this.saveState();
    return {
      success: true,
      message: `Configuration updated for "${sourceId}". Restart the source for changes to take effect.`,
    };
  }

  // ── Custom source management ─────────────────────────────

  /**
   * Add a user-defined custom data source.
   */
  addCustomSource(
    definition: CustomSourceDefinition
  ): { success: boolean; message: string } {
    // Validate
    if (!definition.id || !/^[a-z0-9_-]+$/.test(definition.id)) {
      return {
        success: false,
        message: "Source ID must be lowercase alphanumeric with hyphens/underscores.",
      };
    }

    if (this.adapters.has(`custom-${definition.id}`)) {
      return {
        success: false,
        message: `Custom source "${definition.id}" already exists.`,
      };
    }

    if (!["file_watcher", "shell_command", "webhook"].includes(definition.mode)) {
      return {
        success: false,
        message: 'Mode must be "file_watcher", "shell_command", or "webhook".',
      };
    }

    // shell_command sources run arbitrary executables on the host. On a
    // networked deployment that is remote code execution, so it is disabled
    // unless explicitly opted in on a trusted local instance.
    if (
      definition.mode === "shell_command" &&
      process.env.MEMORIA_ALLOW_SHELL_SOURCES !== "true"
    ) {
      return {
        success: false,
        message:
          "shell_command sources are disabled for security (arbitrary command execution). " +
          "Set MEMORIA_ALLOW_SHELL_SOURCES=true on a trusted local instance to enable them.",
      };
    }

    // webhook mode has no HTTP delivery route wired (pushWebhookEvent is never
    // called), so a webhook source would silently collect nothing. Reject it
    // rather than present a dead no-op. Push events to the authenticated
    // /ingest endpoint, or use file_watcher / shell_command instead.
    if (definition.mode === "webhook") {
      return {
        success: false,
        message:
          "webhook custom sources are not yet supported (no HTTP delivery endpoint is wired). " +
          "Push events to the authenticated /ingest endpoint, or use a file_watcher or shell_command source.",
      };
    }

    // file_watcher sources read an arbitrary host path. Contain it so a watcher
    // can't be pointed at the collector's own key/credential store (or, when an
    // allowlist is configured, anywhere outside it).
    if (definition.mode === "file_watcher") {
      if (!definition.watchPath) {
        return { success: false, message: "file_watcher sources require a watchPath." };
      }
      try {
        assertWatchPathAllowed(definition.watchPath, { dataDir: this.dataDir });
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    }

    // Register the adapter
    const adapter = new CustomAdapter(definition, { dataDir: this.dataDir });
    this.adapters.set(`custom-${definition.id}`, adapter);
    this.state.customSources.push(definition);
    this.saveState();

    return {
      success: true,
      message:
        `Custom source "${definition.name}" added (ID: custom-${definition.id}). ` +
        `Enable it with action "enable" and source "custom-${definition.id}".`,
    };
  }

  /**
   * Remove a custom data source.
   */
  async removeCustomSource(
    sourceId: string
  ): Promise<{ success: boolean; message: string }> {
    const fullId = sourceId.startsWith("custom-") ? sourceId : `custom-${sourceId}`;

    if (!this.adapters.has(fullId)) {
      return { success: false, message: `Custom source "${sourceId}" not found.` };
    }

    // Disable first
    await this.disableSource(fullId);

    // Remove from registry
    this.adapters.delete(fullId);
    this.state.customSources = this.state.customSources.filter(
      (d) => `custom-${d.id}` !== fullId
    );
    delete this.state.configs[fullId];
    delete this.state.checkpoints[fullId];
    delete this.state.eventCounts[fullId];

    this.saveState();
    return { success: true, message: `Custom source "${sourceId}" removed.` };
  }

  // ── User agreement ───────────────────────────────────────

  /**
   * Record user consent for a source.
   */
  recordAgreement(sourceId: string): void {
    if (!this.state.agreement) {
      this.state.agreement = {
        agreedAt: new Date().toISOString(),
        sources: [],
        version: 1,
      };
    }

    if (!this.state.agreement.sources.includes(sourceId)) {
      this.state.agreement.sources.push(sourceId);
      this.state.agreement.agreedAt = new Date().toISOString();
    }

    this.saveState();
  }

  hasAgreement(sourceId: string): boolean {
    return this.state.agreement?.sources.includes(sourceId) ?? false;
  }

  // ── Polling (used by the daemon) ─────────────────────────

  /**
   * Get all active (enabled + initialized) adapters.
   */
  getActiveAdapters(): Map<string, SourceAdapter> {
    return this.activeAdapters;
  }

  /**
   * The effective config for a source: the adapter's static defaults overlaid
   * with any persisted per-source overrides. Use this (not info.defaultConfig)
   * to read runtime settings like pollIntervalSec.
   */
  getEffectiveConfig(sourceId: string): AdapterConfig | null {
    const adapter = this.adapters.get(sourceId);
    if (!adapter) return null;
    return { ...adapter.info.defaultConfig, ...this.state.configs[sourceId] };
  }

  /**
   * Record that events were collected.
   */
  recordEvents(sourceId: string, count: number): void {
    this.state.eventCounts[sourceId] =
      (this.state.eventCounts[sourceId] ?? 0) + count;
    this.lastPolled.set(sourceId, new Date().toISOString());
  }

  /**
   * Save checkpoints for all active adapters.
   */
  saveCheckpoints(): void {
    for (const [id, adapter] of this.activeAdapters) {
      this.state.checkpoints[id] = adapter.getCheckpoint();
    }
    this.saveState();
  }

  // ── Dependency auto-installer ────────────────────────────

  private checkDependencies(deps: string[]): boolean {
    if (deps.length === 0) return true;

    for (const dep of deps) {
      try {
        require.resolve(dep);
      } catch {
        // Also check if it's in the project's node_modules
        const modPath = path.join(this.projectDir, "node_modules", dep);
        if (!fs.existsSync(modPath)) return false;
      }
    }
    return true;
  }

  private async installDependencies(
    deps: string[]
  ): Promise<{ success: boolean; message: string }> {
    const missing = deps.filter((d) => {
      try {
        require.resolve(d);
        return false;
      } catch {
        const modPath = path.join(this.projectDir, "node_modules", d);
        return !fs.existsSync(modPath);
      }
    });

    if (missing.length === 0) {
      return { success: true, message: "All dependencies already installed." };
    }

    // Validate each name against a strict npm package-name (+ optional version)
    // pattern before shelling out. Built-in adapter deps are hardcoded today,
    // but this prevents a future/custom source from injecting an npm flag (e.g.
    // a leading "-") or junk via a crafted name. execFileSync (no shell) also
    // removes the metacharacter-injection risk of the old execSync string.
    const NPM_DEP = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-zA-Z0-9-._^~><=. |*x]+)?$/;
    const invalid = missing.filter((d) => !NPM_DEP.test(d));
    if (invalid.length > 0) {
      return {
        success: false,
        message: `Refusing to install invalid dependency name(s): ${invalid.join(", ")}`,
      };
    }

    process.stderr.write(
      `Memoria: auto-installing dependencies: ${missing.join(", ")}\n`
    );

    try {
      execFileSync("npm", ["install", "--save", ...missing], {
        cwd: this.projectDir,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      return {
        success: true,
        message: `Installed: ${missing.join(", ")}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `npm install failed: ${err.stderr?.slice(0, 200) ?? err.message}`,
      };
    }
  }

  // ── State persistence (encrypted) ────────────────────────

  private loadState(): RegistryState {
    const defaultState: RegistryState = {
      configs: {},
      checkpoints: {},
      customSources: [],
      agreement: null,
      eventCounts: {},
    };

    if (!fs.existsSync(this.configPath)) return defaultState;

    try {
      const encrypted = fs.readFileSync(this.configPath, "utf-8");
      return decryptJSON<RegistryState>(encrypted);
    } catch (err) {
      // The file exists but failed to decrypt/parse (wrong key, corruption, or
      // tampering). Do NOT silently discard it — that permanently loses the
      // encrypted credentials and checkpoints. Preserve the original for manual
      // recovery and start with empty in-memory state so the app still runs.
      const backup = `${this.configPath}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(this.configPath, backup);
        process.stderr.write(
          `Memoria: SECURITY/DATA — collector config failed to decrypt (${(err as Error).message}). ` +
            `Preserved the original at ${backup}; starting with empty state. ` +
            `If MEMORIA_ENCRYPTION_KEY changed, restore the matching key to recover stored credentials.\n`
        );
      } catch (backupErr) {
        process.stderr.write(
          `Memoria: collector config failed to decrypt and the backup also failed ` +
            `(${(backupErr as Error).message}); leaving the original in place. ` +
            `Operator action required before re-enabling sources.\n`
        );
      }
      return defaultState;
    }
  }

  private saveState(): void {
    const encrypted = encryptJSON(this.state);
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, encrypted);
  }

  // ── Cleanup ──────────────────────────────────────────────

  async destroy(): Promise<void> {
    this.saveCheckpoints();
    for (const [_, adapter] of this.activeAdapters) {
      await adapter.destroy();
    }
    this.activeAdapters.clear();
  }
}
