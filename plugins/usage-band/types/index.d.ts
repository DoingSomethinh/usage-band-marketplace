export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageSnapshot = {
  windows: UsageWindow[]
  costUsd?: number
  contextPercent?: number
}

export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: UsageSnapshot | null
      tokens: TokenTotals
      tick: number
      isHidden: boolean
    }
  }
}
