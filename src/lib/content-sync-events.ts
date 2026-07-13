export const contentSyncStateChanged = "builder-blog:content-sync-state-changed";
export const workspaceRefreshRequested = "builder-blog:workspace-refresh-requested";

export const LIVE_POLL_RUNNING_MS = 5_000;
export const LIVE_POLL_IDLE_MS = 15_000;

export type ContentSyncStateChange = {
  version: string;
};

export type WorkspaceRefreshRequest = {
  source: string;
};

export function requestWorkspaceRefresh(source: string) {
  if (typeof window === "undefined") return;
  const detail: WorkspaceRefreshRequest = { source };
  window.dispatchEvent(new CustomEvent(workspaceRefreshRequested, { detail }));
}

export function liveDataSignature(value: unknown): string {
  return JSON.stringify(value);
}
