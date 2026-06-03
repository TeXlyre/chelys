// src/config.ts
import chelysConfig from '../chelys.config';
import { getActiveAccountId } from './plugin-host/activeAccount';

export interface PeerConfig {
  rootDir: string;
  docUrl: string;
  userId: string;
  username: string;
  signalingServers: string[];
  websocketServer?: string;
  filePizzaServer: string;
  autoSyncIntervalSeconds: number;
  holdTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  conflictResolution: "prefer-latest" | "prefer-local" | "notify";
  awarenessTimeout: number;
  notifications: boolean;
}

export interface RoomDefaults {
  signalingServers: string[];
  autoReconnect: boolean;
}

let cfg: PeerConfig | null = null;

export const setPeerConfig = (c: PeerConfig) => {
  cfg = c;
};

export const getPeerConfig = (): PeerConfig => {
  if (!cfg) throw new Error("Peer config not initialized");
  return cfg;
};

// Defaults

export const SETTINGS_DEFAULTS: Record<string, unknown> =
  chelysConfig.userdata.default.settings;

export const getSettingDefault = <T = unknown>(id: string): T =>
  SETTINGS_DEFAULTS[id] as T;

export const getChelysSettingsKey = (userId: string): string =>
  `chelys-user-${userId}-settings`;

export const getStoredSetting = <T = unknown>(id: string): T => {
  const accountId = getActiveAccountId();
  if (accountId) {
    try {
      const raw = localStorage.getItem(getChelysSettingsKey(accountId));
      if (raw) {
        const { _version, ...entries } = JSON.parse(raw);
        if (entries[id] !== undefined) return entries[id] as T;
      }
    } catch {
      /* fall through to default */
    }
  }
  return getSettingDefault<T>(id);
};

export const ROOM_DEFAULTS: RoomDefaults = {
  signalingServers: getStoredSetting<string>('collabSignalingServers')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  autoReconnect: getStoredSetting<boolean>('collabAutoReconnect'),
};