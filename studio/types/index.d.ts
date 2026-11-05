export type ToolStep = { tool: string; target: string }

export type TurnRecord = {
  id: string
  prompt: string
  answer: string
  tools: ToolStep[]
  files: string[]
  durationMs: number
  model: string
  usd: number
  cacheHit: number | null
  endedAt: number
}

export type Term = { term: string; meaning: string }

export type Explanation = {
  turnId: string
  title: string
  tldr: string
  steps: string[]
  why: string
  terms: Term[]
  next: string
  risk: string
  createdAt: number
  tokens: number
}

export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type Usage = {
  ctxPercent: number | null
  ctxTokens: number | null
  window: number
  limits: Limit[]
  usd: number | null
  startedAt: number
}

export type CommandSource = 'builtin' | 'plugin' | 'user' | 'mcp'

// One slash command as the Commands pane lists it; `group` is empty for built-ins.
export type CommandEntry = { name: string; description: string; source: CommandSource; group: string }

declare module 'claude-code' {
  interface PluginState {
    studio: {
      cmds: CommandEntry[]
      cmdsListed: boolean
      favs: string[]
      openGroups: string[]
      focused: string
      rec: boolean
      recWords: string[]
      usage: Usage | null
      now: number
      prompts: number
      branch: string
      project: string
      turns: TurnRecord[]
      ctxTrend: number[]
      explains: Explanation[]
      view: number
      busy: boolean
      error: string
      termsLearned: number
      collapsed: boolean
    }
  }
}
