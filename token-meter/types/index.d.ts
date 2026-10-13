export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
  turns: number
}

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { last: Usage | null; session: Usage; pending: Usage }
  }
}
