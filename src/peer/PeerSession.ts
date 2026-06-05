// src/peer/PeerSession.ts
import { nanoid } from "nanoid";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

import { collabService } from "@texlyre/services/CollabService";
import { fileSyncService } from "@texlyre/services/FileSyncService";
import { fileStorageService } from "@texlyre/services/FileStorageService";
import type {
  FileSyncHoldSignal,
  FileSyncInfo,
  FileSyncRequest,
  FileSyncVerification,
} from "@texlyre/types/fileSync";
import { getPeerConfig } from "../config";

export interface PeerStats {
  connected: boolean;
  peers: number;
  localFiles: number;
  filesUploaded: number;
  bytesUploaded: number;
  filesDownloaded: number;
  bytesDownloaded: number;
  pendingIncomingRequests: number;
  pendingOutgoingRequests: number;
  activeHolds: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

type StatsListener = (stats: PeerStats) => void;

const INITIAL_STATS: PeerStats = {
  connected: false,
  peers: 0,
  localFiles: 0,
  filesUploaded: 0,
  bytesUploaded: 0,
  filesDownloaded: 0,
  bytesDownloaded: 0,
  pendingIncomingRequests: 0,
  pendingOutgoingRequests: 0,
  activeHolds: 0,
  lastSyncAt: null,
  lastError: null,
};

export class PeerSession {
  private doc: Y.Doc | null = null;
  private projectId = "";
  private userId = "";
  private fileSyncAwareness: Awareness | null = null;
  private awarenessChangeHandler: (() => void) | null = null;
  private syncIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private syncThrottleHandle: ReturnType<typeof setTimeout> | null = null;
  private activeHolds = new Set<string>();
  private holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processedRequests = new Set<string>();

  private stats: PeerStats = { ...INITIAL_STATS };
  private statsListeners: StatsListener[] = [];

  getStats(): PeerStats {
    return { ...this.stats };
  }

  addStatsListener(cb: StatsListener): () => void {
    this.statsListeners.push(cb);
    cb(this.getStats());
    return () => {
      this.statsListeners = this.statsListeners.filter((l) => l !== cb);
    };
  }

  private clearSyncFailureFlags(): void {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sync-failures-") || key.startsWith("sync-disabled-")) {
        localStorage.removeItem(key);
      }
    }
  }

  async start(docUrl: string): Promise<void> {
    this.clearSyncFailureFlags();
    this.projectId = docUrl.startsWith("yjs:") ? docUrl.slice(4) : docUrl;
    await this.attachCollab();
    this.syncIntervalHandle = setInterval(
      () => void this.performSync(),
      getPeerConfig().autoSyncIntervalSeconds * 1000,
    );
  }

  stop(): void {
    if (this.syncIntervalHandle) clearInterval(this.syncIntervalHandle);
    if (this.syncThrottleHandle) clearTimeout(this.syncThrottleHandle);
    this.syncIntervalHandle = null;
    this.syncThrottleHandle = null;
    this.detachCollab();
    fileSyncService.cleanup();
    this.emit({ connected: false, peers: 0 });
  }

  async reattachCollab(): Promise<void> {
    console.warn("[PeerSession] Reattaching file_sync collab");
    this.detachCollab();
    await new Promise((r) => setTimeout(r, 300));
    await this.attachCollab();
  }

  requestSyncSoon(): void {
    if (this.syncThrottleHandle) clearTimeout(this.syncThrottleHandle);
    this.syncThrottleHandle = setTimeout(() => {
      this.syncThrottleHandle = null;
      void this.performSync();
    }, 1000);
  }

  private async attachCollab(): Promise<void> {
    const cfg = getPeerConfig();
    this.userId = cfg.userId;

    const { doc, provider } = collabService.connect(this.projectId, "file_sync", {
      signalingServers: cfg.signalingServers,
      websocketServer: cfg.websocketServer,
      autoReconnect: true,
      awarenessTimeout: cfg.awarenessTimeout,
    });

    this.doc = doc;
    this.fileSyncAwareness = provider?.awareness ?? null;

    collabService.setUserInfo(this.projectId, "file_sync", {
      id: this.userId,
      username: cfg.username,
      name: cfg.username,
      color: "#7da8c4",
      colorLight: "#a8c4dc",
      passwordHash: "",
      createdAt: 0,
    });

    this.emit({ connected: true });
    this.cleanupStaleRequests();

    doc.getMap("fileSync").observe(() => {
      void this.checkAndRequestFiles();
    });

    if (this.fileSyncAwareness) {
      this.awarenessChangeHandler = () => this.onAwarenessChange();
      this.fileSyncAwareness.on("change", this.awarenessChangeHandler);
      this.updatePeerCount();
    }

    doc.getArray<FileSyncRequest>("syncRequests").observe(() => this.onRequestsChange());
    doc.getArray<FileSyncVerification>("verifications").observe(() => this.onVerificationsChange());

    await this.updateLocalFileMap();
    await this.checkAndRequestFiles();
  }

  private detachCollab(): void {
    for (const timer of this.holdTimers.values()) clearTimeout(timer);
    this.holdTimers.clear();
    this.activeHolds.clear();
    this.processedRequests.clear();

    if (this.fileSyncAwareness) {
      if (this.awarenessChangeHandler) {
        this.fileSyncAwareness.off("change", this.awarenessChangeHandler);
        this.awarenessChangeHandler = null;
      }
      try {
        this.fileSyncAwareness.setLocalState(null);
      } catch (error) {
        console.warn("[PeerSession] Failed to clear awareness:", error);
      }
      this.fileSyncAwareness = null;
    }

    if (this.doc) {
      this.doc.getMap("fileSync").delete(this.userId);
    }

    if (this.projectId) collabService.disconnect(this.projectId, "file_sync");
    this.doc = null;
  }

  private emit(patch: Partial<PeerStats>): void {
    this.stats = { ...this.stats, ...patch };
    const snapshot = this.getStats();
    this.statsListeners.forEach((l) => l(snapshot));
  }

  private connectedUserIds(): Set<string> {
    const ids = new Set<string>();
    this.fileSyncAwareness?.getStates().forEach((state) => {
      const id = (state as { user?: { id?: string } }).user?.id;
      if (id) ids.add(id);
    });
    return ids;
  }

  private updatePeerCount(): void {
    const connected = this.connectedUserIds();
    connected.delete(this.userId);
    this.emit({ peers: connected.size });
  }

  private onAwarenessChange(): void {
    this.updatePeerCount();
    this.purgeDisconnectedPeers();
  }

  private purgeDisconnectedPeers(): void {
    if (!this.doc || !this.fileSyncAwareness) return;

    const connected = this.connectedUserIds();
    const fileSyncMap = this.doc.getMap("fileSync");

    const disconnected: string[] = [];
    fileSyncMap.forEach((_, key) => {
      if (key !== this.userId && !connected.has(key)) disconnected.push(key);
    });

    if (!disconnected.length) return;

    const gone = new Set(disconnected);
    for (const key of disconnected) fileSyncMap.delete(key);

    const requestsArray = this.doc.getArray<FileSyncRequest>("syncRequests");
    for (let i = requestsArray.length - 1; i >= 0; i--) {
      const request = requestsArray.get(i);
      if (gone.has(request.providerId) || gone.has(request.requesterId)) {
        this.processedRequests.delete(request.id);
        this.processedRequests.delete(`download_${request.id}`);
        requestsArray.delete(i, 1);
      }
    }

    const holdSignalsArray = this.doc.getArray<FileSyncHoldSignal>("holdSignals");
    for (let i = holdSignalsArray.length - 1; i >= 0; i--) {
      const signal = holdSignalsArray.get(i);
      if (gone.has(signal.targetPeerId) || (signal.holderId && gone.has(signal.holderId))) {
        holdSignalsArray.delete(i, 1);
        this.clearHold(signal.targetPeerId);
      }
    }

    this.refreshRequestCounts();
  }

  private onRequestsChange(): void {
    if (!this.doc) return;
    this.refreshRequestCounts();
    for (const request of this.doc.getArray<FileSyncRequest>("syncRequests").toArray()) {
      if (request.providerId === this.userId && request.status === "pending") {
        void this.handleIncomingSyncRequest(request);
      } else if (request.requesterId === this.userId && request.status === "ready") {
        void this.handleSyncRequestUpdate(request);
      }
    }
  }

  private onVerificationsChange(): void {
    if (!this.doc) return;
    for (const v of this.doc.getArray<FileSyncVerification>("verifications").toArray()) {
      if (v.providerId !== this.userId) continue;
      if (v.status === "success") {
        fileSyncService.releaseUploader(v.requestId);
        this.processedRequests.delete(v.requestId);
        setTimeout(() => void this.updateLocalFileMap(), 1000);
      }
    }
  }

  private refreshRequestCounts(): void {
    if (!this.doc) return;
    const arr = this.doc.getArray<FileSyncRequest>("syncRequests").toArray();
    let incoming = 0;
    let outgoing = 0;
    for (const r of arr) {
      if (r.providerId === this.userId && r.status === "pending") incoming++;
      if (r.requesterId === this.userId && (r.status === "pending" || r.status === "ready")) outgoing++;
    }
    this.emit({
      pendingIncomingRequests: incoming,
      pendingOutgoingRequests: outgoing,
      activeHolds: this.activeHolds.size,
    });
  }

  private async performSync(): Promise<void> {
    if (!this.doc) return;
    this.purgeDisconnectedPeers();
    this.cleanupExpiredHolds();
    this.cleanupStaleRequests();
    await this.updateLocalFileMap();
    await this.checkAndRequestFiles();
  }

  private async updateLocalFileMap(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const cfg = getPeerConfig();
    const localFiles = await fileSyncService.getLocalFileSyncInfo(
      this.userId,
      cfg.username,
      `yjs:${this.projectId}`,
    );
    if (this.doc !== doc) return;
    doc.getMap("fileSync").set(this.userId, localFiles);
    this.emit({ localFiles: localFiles.length });
  }

  private async checkAndRequestFiles(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const cfg = getPeerConfig();
    const localFiles = await fileSyncService.getLocalFileSyncInfo(
      this.userId,
      cfg.username,
      `yjs:${this.projectId}`,
    );
    if (this.doc !== doc) return;
    const fileSyncMap = doc.getMap("fileSync");

    fileSyncMap.forEach((remoteFiles, peerId) => {
      if (peerId === this.userId || fileSyncService.isSyncDisabledForPeer(peerId)) return;
      const remote = remoteFiles as FileSyncInfo[];
      if (!fileSyncService.shouldTriggerSync(localFiles, remote)) return;
      const filesToRequest = fileSyncService.determineFilesToRequest(
        localFiles,
        remote,
        cfg.conflictResolution,
      );
      if (!filesToRequest.length) return;
      const holdSignal = this.issueHoldSignal(peerId);
      if (!holdSignal) return;

      setTimeout(() => {
        if (!this.doc) return;
        const syncRequest: FileSyncRequest = {
          id: nanoid(),
          requesterId: this.userId,
          requesterUsername: cfg.username,
          providerId: peerId,
          files: filesToRequest.map((f) => f.remoteFileId),
          filePaths: filesToRequest.map((f) => f.filePath),
          remoteTimestamps: filesToRequest.map((f) => f.lastModified),
          documentIds: filesToRequest.map((f) => f.documentId),
          deletionStates: filesToRequest.map((f) => f.isDeleted ?? false),
          timestamp: Date.now(),
          status: "pending",
          holdSignalId: holdSignal.id,
        };
        doc.getArray<FileSyncRequest>("syncRequests").push([syncRequest]);
        this.refreshRequestCounts();
      }, 1000);
    });
  }

  private async handleIncomingSyncRequest(request: FileSyncRequest): Promise<void> {
    if (!this.doc) return;
    const cfg = getPeerConfig();
    if (this.isRequestExpired(request)) {
      this.deleteRequest(request.id);
      return;
    }
    if (this.processedRequests.has(request.id)) return;
    this.processedRequests.add(request.id);

    try {
      const bytes = await this.sumBytesForIds(request.files);
      const uploadResult = await fileSyncService.uploadFiles(
        request.files,
        request.id,
        cfg.filePizzaServer,
        `yjs:${this.projectId}`,
      );
      this.updateRequest(request.id, {
        providerUsername: cfg.username,
        status: "ready",
        filePizzaLink: uploadResult.link,
        timestamp: Date.now(),
      });
      this.emit({
        filesUploaded: this.stats.filesUploaded + request.files.length,
        bytesUploaded: this.stats.bytesUploaded + bytes,
        lastSyncAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error("[PeerSession] uploadFiles failed:", error);
      this.updateRequest(request.id, { status: "failed", timestamp: Date.now() });
      this.processedRequests.delete(request.id);
      this.emit({ lastError: message });
    }
  }

  private async handleSyncRequestUpdate(request: FileSyncRequest): Promise<void> {
    if (!this.doc || !request.filePizzaLink) return;
    const cfg = getPeerConfig();
    if (this.isRequestExpired(request)) {
      this.deleteRequest(request.id);
      return;
    }

    const key = `download_${request.id}`;
    if (this.processedRequests.has(key)) return;
    this.processedRequests.add(key);

    try {
      const remoteTimestamps = new Map<string, number>();
      const remoteDocumentIds = new Map<string, string>();
      const remoteDeletionStates = new Map<string, boolean>();
      request.filePaths?.forEach((path, i) => {
        const ts = request.remoteTimestamps?.[i];
        const did = request.documentIds?.[i];
        const del = request.deletionStates?.[i];
        if (ts) remoteTimestamps.set(path, ts);
        if (did) remoteDocumentIds.set(path, did);
        if (del !== undefined) remoteDeletionStates.set(path, del);
      });

      await fileSyncService.downloadFiles(
        request.filePizzaLink,
        request.filePaths || request.files,
        remoteTimestamps,
        remoteDocumentIds,
        remoteDeletionStates,
        cfg.filePizzaServer,
        `yjs:${this.projectId}`,
      );

      const bytes = await this.sumBytesForPaths(request.filePaths || []);

      this.deleteRequest(request.id);
      this.doc.getArray<FileSyncVerification>("verifications").push([
        {
          id: nanoid(),
          requestId: request.id,
          verifierId: this.userId,
          verifierUsername: cfg.username,
          providerId: request.providerId,
          timestamp: Date.now(),
          status: "success",
        },
      ]);
      this.releaseHoldSignal(request.holdSignalId);
      fileSyncService.clearSyncFailures(request.providerId);
      await this.updateLocalFileMap();
      this.emit({
        filesDownloaded: this.stats.filesDownloaded + request.files.length,
        bytesDownloaded: this.stats.bytesDownloaded + bytes,
        lastSyncAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      fileSyncService.trackSyncFailure(request.providerId);
      this.updateRequest(request.id, { status: "failed", timestamp: Date.now() });
      this.doc.getArray<FileSyncVerification>("verifications").push([
        {
          id: nanoid(),
          requestId: request.id,
          verifierId: this.userId,
          verifierUsername: cfg.username,
          providerId: request.providerId,
          timestamp: Date.now(),
          status: "failure",
          message,
        },
      ]);
      this.releaseHoldSignal(request.holdSignalId);
      this.processedRequests.delete(key);
      this.emit({ lastError: message });
    }
  }

  private issueHoldSignal(targetPeerId: string): FileSyncHoldSignal | null {
    if (!this.doc || this.activeHolds.has(targetPeerId)) return null;
    const cfg = getPeerConfig();
    const signal: FileSyncHoldSignal = {
      id: nanoid(),
      holderId: this.userId,
      holderUsername: cfg.username,
      targetPeerId,
      timestamp: Date.now(),
      expiresAt: Date.now() + cfg.holdTimeoutSeconds * 1000,
      status: "active",
    };
    this.doc.getArray<FileSyncHoldSignal>("holdSignals").push([signal]);
    this.activeHolds.add(targetPeerId);
    this.emit({ activeHolds: this.activeHolds.size });
    const timer = setTimeout(() => this.clearHold(targetPeerId), cfg.holdTimeoutSeconds * 1000);
    this.holdTimers.set(targetPeerId, timer);
    return signal;
  }

  private clearHold(targetPeerId: string): void {
    const timer = this.holdTimers.get(targetPeerId);
    if (timer) {
      clearTimeout(timer);
      this.holdTimers.delete(targetPeerId);
    }
    if (this.activeHolds.delete(targetPeerId)) {
      this.emit({ activeHolds: this.activeHolds.size });
    }
  }

  private releaseHoldSignal(holdSignalId: string): void {
    if (!this.doc) return;
    const arr = this.doc.getArray<FileSyncHoldSignal>("holdSignals");
    for (let i = 0; i < arr.length; i++) {
      const s = arr.get(i);
      if (s.id !== holdSignalId || s.holderId !== this.userId) continue;
      arr.delete(i, 1);
      arr.insert(i, [{ ...s, status: "released" }]);
      this.clearHold(s.targetPeerId);
      break;
    }
  }

  private cleanupExpiredHolds(): void {
    if (!this.doc) return;
    const arr = this.doc.getArray<FileSyncHoldSignal>("holdSignals");
    const now = Date.now();
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr.get(i);
      if (s.expiresAt >= now || s.status !== "active") continue;
      arr.delete(i, 1);
      arr.insert(i, [{ ...s, status: "expired" }]);
      if (s.holderId === this.userId) this.clearHold(s.targetPeerId);
    }
    this.emit({ activeHolds: this.activeHolds.size });
  }

  private cleanupStaleRequests(): void {
    if (!this.doc) return;
    const cfg = getPeerConfig();
    const arr = this.doc.getArray<FileSyncRequest>("syncRequests");
    const now = Date.now();
    const timeoutMs = cfg.requestTimeoutSeconds * 1000;
    for (let i = arr.length - 1; i >= 0; i--) {
      const r = arr.get(i);
      if (r.status === "completed" || r.status === "failed" || now - r.timestamp > timeoutMs) {
        this.processedRequests.delete(r.id);
        this.processedRequests.delete(`download_${r.id}`);
        arr.delete(i, 1);
      }
    }
  }

  private updateRequest(requestId: string, patch: Partial<FileSyncRequest>): void {
    if (!this.doc) return;
    const arr = this.doc.getArray<FileSyncRequest>("syncRequests");
    const i = arr.toArray().findIndex((r) => r.id === requestId);
    if (i < 0) return;
    const current = arr.get(i);
    arr.delete(i, 1);
    arr.insert(i, [{ ...current, ...patch }]);
  }

  private deleteRequest(requestId: string): void {
    if (!this.doc) return;
    const arr = this.doc.getArray<FileSyncRequest>("syncRequests");
    const i = arr.toArray().findIndex((r) => r.id === requestId);
    if (i >= 0) arr.delete(i, 1);
    this.processedRequests.delete(requestId);
    this.processedRequests.delete(`download_${requestId}`);
  }

  private isRequestExpired(request: FileSyncRequest): boolean {
    return Date.now() - request.timestamp > getPeerConfig().requestTimeoutSeconds * 1000;
  }

  private async sumBytesForIds(ids: string[]): Promise<number> {
    let total = 0;
    for (const id of ids) {
      try {
        const f = await fileStorageService.getFile(id);
        if (f?.size) total += f.size;
      } catch { }
    }
    return total;
  }

  private async sumBytesForPaths(paths: string[]): Promise<number> {
    let total = 0;
    for (const p of paths) {
      try {
        const f = await fileStorageService.getFileByPath(p, true);
        if (f?.size) total += f.size;
      } catch { }
    }
    return total;
  }
}
