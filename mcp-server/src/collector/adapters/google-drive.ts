/**
 * Google Drive adapter — monitors user-selected folders for file changes.
 *
 * Features:
 *   - Watch specific folders (by folder ID or name)
 *   - Detect new, modified, and renamed files
 *   - Read content from Google Docs, Sheets (exported as text)
 *   - Track file metadata (owner, last modifier, shared status)
 *   - changes.list-based incremental sync via startPageToken
 *
 * Does NOT download binary files (images, videos, ZIPs) — only indexes
 * metadata and text-exportable content (Docs, Sheets, plain text, markdown).
 *
 * Requires: googleapis npm package (auto-installed)
 */

import type { SourceAdapter, AdapterInfo, AdapterConfig, RawEvent } from "./base.js";
import { estimateImportance, classifyPrivacy } from "./base.js";
import { getGoogleAuth, extractGoogleAuthConfig } from "./google-auth.js";

// MIME types we can extract text content from
const TEXT_EXPORTABLE: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "text/plain": "text/plain",
  "text/markdown": "text/markdown",
  "text/csv": "text/csv",
  "application/json": "application/json",
};

// Max content to extract per file (chars)
const MAX_CONTENT_LENGTH = 1000;

export class GoogleDriveAdapter implements SourceAdapter {
  readonly info: AdapterInfo = {
    id: "google-drive",
    name: "Google Drive",
    description:
      "Monitors selected Google Drive folders for file changes. Indexes document content from Docs, Sheets, and text files.",
    platforms: ["macos", "linux", "windows"],
    dependencies: ["googleapis"],
    requiredPermissions: [
      "Google OAuth 2.0 credentials (client_id, client_secret, refresh_token)",
      "Google Drive API enabled in Google Cloud Console",
    ],
    builtIn: true,
    defaultConfig: {
      enabled: false,
      pollIntervalSec: 600, // 10 minutes
      importanceThreshold: 3,
      settings: {
        google_client_id: "",
        google_client_secret: "",
        google_refresh_token: "",
        folderIds: [], // Google Drive folder IDs to watch (empty = root)
        folderNames: [], // Human-readable names (for display only)
        includeSharedDrives: false,
        includeContent: true, // Extract text content from docs
        maxContentChars: MAX_CONTENT_LENGTH,
      },
    },
  };

  private drive: any = null;
  private checkpoint: string = ""; // JSON: { pageToken, seenFiles }
  private startPageToken: string = "";
  private seenFiles: Set<string> = new Set();
  private config!: AdapterConfig;

  async init(config: AdapterConfig): Promise<void> {
    this.config = config;
    const authConfig = extractGoogleAuthConfig(config.settings as Record<string, any>);
    const auth = await getGoogleAuth(authConfig);

    const { google } = await import("googleapis");
    this.drive = google.drive({ version: "v3", auth });

    // Restore checkpoint
    if (this.checkpoint) {
      try {
        const parsed = JSON.parse(this.checkpoint);
        this.startPageToken = parsed.pageToken || "";
        this.seenFiles = new Set(parsed.seenFiles || []);
      } catch (err) {
        process.stderr.write(
          `Memoria google-drive: invalid checkpoint, starting fresh: ${(err as Error).message}\n`,
        );
        // Clear corrupted checkpoint so we don't retry it on every poll
        this.checkpoint = "";
        this.startPageToken = "";
        this.seenFiles = new Set();
      }
    }

    // Get initial page token if none
    if (!this.startPageToken) {
      try {
        const response = await this.drive.changes.getStartPageToken({
          supportsAllDrives: this.config.settings?.includeSharedDrives === true,
        });
        this.startPageToken = response.data.startPageToken || "";
      } catch (err: any) {
        throw new Error(
          `Google Drive API connection failed: ${err.message}. ` +
            "Ensure the Google Drive API is enabled in your Google Cloud Console.",
          { cause: err },
        );
      }
    }
  }

  async poll(): Promise<RawEvent[]> {
    if (!this.drive) return [];

    const folderIds = (this.config.settings?.folderIds as string[]) ?? [];
    const includeContent = this.config.settings?.includeContent !== false;
    const includeSharedDrives = this.config.settings?.includeSharedDrives === true;

    const events: RawEvent[] = [];

    try {
      // Use changes.list for incremental sync
      let pageToken = this.startPageToken;
      let hasMore = true;

      // NOTE: changes.list is ACCOUNT-WIDE — it returns changes across the whole
      // Drive, and the configured folderIds are applied as a CLIENT-SIDE filter
      // below (isInWatchedFolder). On a large/busy Drive this pulls metadata for
      // many irrelevant files per poll. The Drive API has no server-side
      // folder scope for the changes feed; switching to files.list with a
      // `'<id>' in parents` query would scope it but lose the incremental
      // syncToken. Documented as a known tradeoff.
      while (hasMore) {
        const response = await this.drive.changes.list({
          pageToken,
          pageSize: 100,
          fields:
            "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,modifiedTime,createdTime,parents,lastModifyingUser,owners,shared,webViewLink,size,trashed))",
          includeRemoved: false,
          supportsAllDrives: includeSharedDrives,
          includeItemsFromAllDrives: includeSharedDrives,
        });

        const changes = response.data.changes || [];

        for (const change of changes) {
          if (change.removed || !change.file) continue;
          if (change.file.trashed) continue;

          // Filter by folder if specified
          if (folderIds.length > 0) {
            const parents = change.file.parents || [];
            const inWatchedFolder = parents.some((p: string) => folderIds.includes(p));
            if (!inWatchedFolder) continue;
          }

          const event = await this.convertFileChange(change.file, includeContent);
          if (event) events.push(event);
        }

        if (response.data.newStartPageToken) {
          this.startPageToken = response.data.newStartPageToken;
        }

        pageToken = response.data.nextPageToken;
        hasMore = !!pageToken;
      }
    } catch (err: any) {
      // Page token expired — get a fresh one
      if (err.code === 404 || err.message?.includes("pageToken")) {
        process.stderr.write("Memoria: Drive pageToken expired, resetting\n");
        try {
          const response = await this.drive.changes.getStartPageToken({
            supportsAllDrives: includeSharedDrives,
          });
          this.startPageToken = response.data.startPageToken || "";
        } catch (resetErr) {
          process.stderr.write(
            `Memoria google-drive: failed to reset pageToken: ${(resetErr as Error).message}\n`,
          );
        }
      } else {
        process.stderr.write(`Memoria: Google Drive poll error: ${err.message}\n`);
      }
    }

    return events;
  }

  private async convertFileChange(file: any, includeContent: boolean): Promise<RawEvent | null> {
    if (!file.name || !file.id) return null;

    const isNew = !this.seenFiles.has(file.id);
    this.seenFiles.add(file.id);

    // Limit seen files set size (keep last 5000)
    if (this.seenFiles.size > 5000) {
      const arr = Array.from(this.seenFiles);
      this.seenFiles = new Set(arr.slice(arr.length - 4000));
    }

    const mimeType = file.mimeType || "";
    const isTextExportable = mimeType in TEXT_EXPORTABLE;
    const modifiedTime = file.modifiedTime || new Date().toISOString();
    const lastModifier =
      file.lastModifyingUser?.displayName || file.lastModifyingUser?.emailAddress || "unknown";
    const owner = file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || "unknown";

    // Build content description
    let content = `${isNew ? "New file" : "Modified"}: ${file.name}`;
    if (includeContent && isTextExportable) {
      const sizeBytes = file.size ? parseInt(file.size) : null;
      const extractedText = await this.extractContent(file.id, mimeType, sizeBytes);
      if (extractedText) {
        const maxChars = (this.config.settings?.maxContentChars as number) ?? MAX_CONTENT_LENGTH;
        const preview = extractedText.slice(0, maxChars);
        content += ` — ${preview}`;
      }
    }

    // File type label
    const typeLabels: Record<string, string> = {
      "application/vnd.google-apps.document": "Google Doc",
      "application/vnd.google-apps.spreadsheet": "Google Sheet",
      "application/vnd.google-apps.presentation": "Google Slides",
      "application/vnd.google-apps.folder": "Folder",
      "text/plain": "Text file",
      "text/markdown": "Markdown",
      "application/json": "JSON",
      "application/pdf": "PDF",
    };

    const meta: Record<string, unknown> = {
      fileId: file.id,
      fileName: file.name,
      mimeType,
      fileType: typeLabels[mimeType] ?? mimeType.split("/").pop(),
      isNew,
      lastModifier,
      owner,
      isShared: file.shared ?? false,
      size: file.size ? parseInt(file.size) : null,
      webViewLink: file.webViewLink ?? null,
      parents: file.parents ?? [],
    };

    const importance = estimateImportance(content, meta);
    if (importance < this.config.importanceThreshold) return null;

    // Boost for shared docs (collaboration signal)
    let adjustedImportance = importance;
    if (file.shared) adjustedImportance = Math.min(10, adjustedImportance + 1);
    if (isNew) adjustedImportance = Math.min(10, adjustedImportance + 1);

    const privacy = classifyPrivacy(content, meta);
    if (privacy === "local-only") return null;

    return {
      id: `gdrive-${file.id}-${Date.parse(modifiedTime) || Date.now()}`,
      source: "google-drive",
      eventType: isNew ? "file_created" : "file_modified",
      content:
        privacy === "summarize"
          ? `${isNew ? "New" : "Modified"}: ${file.name} (by ${lastModifier})`
          : content,
      timestamp: modifiedTime,
      meta,
      importanceEstimate: adjustedImportance,
      privacyTier: privacy,
    };
  }

  // ── Content extraction ─────────────────────────────────────

  private async extractContent(
    fileId: string,
    mimeType: string,
    sizeBytes?: number | null,
  ): Promise<string> {
    // Skip whole-file download for large binaries — only a short text preview is
    // ever kept, so pulling a multi-MB file into memory is wasteful and risky.
    // (Google Workspace exports have no reliable pre-known size, so they are
    // still fetched; those are typically small text documents.)
    const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
    if (typeof sizeBytes === "number" && sizeBytes > MAX_DOWNLOAD_BYTES) {
      process.stderr.write(
        `Memoria: Drive skipping content extraction for ${fileId} ` +
          `(${sizeBytes} bytes exceeds ${MAX_DOWNLOAD_BYTES} cap)\n`,
      );
      return "";
    }
    try {
      const exportMime = TEXT_EXPORTABLE[mimeType];
      if (!exportMime) return "";

      if (mimeType.startsWith("application/vnd.google-apps.")) {
        // Google Workspace files — use export
        const response = await this.drive.files.export({
          fileId,
          mimeType: exportMime,
        });
        return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      } else {
        // Regular files — download content
        const response = await this.drive.files.get({
          fileId,
          alt: "media",
        });
        return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      }
    } catch (err: any) {
      // Content extraction is best-effort
      process.stderr.write(
        `Memoria: Drive content extraction failed for ${fileId}: ${err.message}\n`,
      );
      return "";
    }
  }

  // ── List watched folders (utility for the user) ────────────

  async listAvailableFolders(): Promise<Array<{ id: string; name: string; path: string }>> {
    if (!this.drive) return [];

    try {
      const response = await this.drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: "files(id,name,parents)",
        pageSize: 100,
        orderBy: "name",
      });

      return (response.data.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        path: f.parents?.[0] || "root",
      }));
    } catch (err) {
      // Don't disguise an auth/permission/network failure as "no folders" —
      // log it so the operator can tell the difference.
      process.stderr.write(
        `Memoria google-drive: listAvailableFolders failed: ${(err as Error).message}\n`,
      );
      return [];
    }
  }

  getCheckpoint(): string {
    return JSON.stringify({
      pageToken: this.startPageToken,
      seenFiles: Array.from(this.seenFiles).slice(-2000), // Cap stored set
    });
  }

  setCheckpoint(cursor: string): void {
    this.checkpoint = cursor;
    try {
      const parsed = JSON.parse(cursor);
      this.startPageToken = parsed.pageToken || "";
      this.seenFiles = new Set(parsed.seenFiles || []);
    } catch (err) {
      // Corrupt checkpoint — reset to a full re-sync, but say so (otherwise a
      // persistently-bad checkpoint silently re-scans every poll).
      process.stderr.write(
        `Memoria google-drive: corrupt checkpoint, resetting to full sync: ${(err as Error).message}\n`,
      );
      this.startPageToken = "";
      this.seenFiles = new Set();
    }
  }

  async destroy(): Promise<void> {
    this.drive = null;
  }
}
