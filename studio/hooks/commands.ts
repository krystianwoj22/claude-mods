import type { CommandEntry, CommandSource } from '../types'

// ── Commands pane: the data and pure helpers (the hooks live in register.tsx) ──

// The built-ins worth remembering, checked against code.claude.com/docs/en/commands
// and /interactive-mode (Nov 2026). A command shows only when the session lists it.
export type Essential = { group: string; cmd?: string; keys?: string; text: string }

export const ESSENTIALS: Essential[] = [
  { group: 'Session', cmd: 'clear', text: 'Start fresh with an empty context' },
  { group: 'Session', cmd: 'resume', text: 'Go back to an earlier conversation' },
  { group: 'Session', cmd: 'rewind', text: 'Undo: roll chat and code back (or Esc Esc)' },
  { group: 'Session', cmd: 'btw', text: 'Side question that stays out of the chat' },
  { group: 'Context running out', cmd: 'context', text: 'See what fills your context window' },
  { group: 'Context running out', cmd: 'compact', text: 'Summarize the chat to free up context' },
  { group: 'Model & thinking', cmd: 'model', text: 'Switch model (arrows set effort)' },
  { group: 'Model & thinking', cmd: 'effort', text: 'How hard Claude thinks: low to max' },
  { group: 'Model & thinking', cmd: 'plan', text: 'Plan first, change nothing until you approve' },
  { group: 'Setup', cmd: 'init', text: 'Create a CLAUDE.md guide for this project' },
  { group: 'Setup', cmd: 'memory', text: 'Edit CLAUDE.md files and auto memory' },
  { group: 'Setup', cmd: 'mcp', text: 'Manage connected MCP servers' },
  { group: 'Setup', cmd: 'reload-plugins', text: 'Load plugin changes without restarting' },
  { group: 'Review', cmd: 'diff', text: 'Review file changes, Claude’s edits too' },
  { group: 'Review', cmd: 'code-review', text: 'Find bugs in your current changes' },
  { group: 'Review', cmd: 'copy', text: 'Copy Claude’s last answer' },
  { group: 'Keys', keys: 'Shift+Tab', text: 'Switch mode: manual, accept edits, plan, auto' },
  { group: 'Keys', keys: 'Esc', text: 'Stop Claude mid-answer, work so far is kept' },
  { group: 'Keys', keys: '!', text: 'Start a line with ! to run a shell command' },
  { group: 'Keys', keys: '@', text: 'Mention a file so Claude reads it' },
  { group: 'Keys', keys: 'Ctrl+X Tab', text: 'Jump to the studio bar, then C, E, R or M' },
]

export const OWN = 'Your own'

// Where a command comes from, as the pane groups it; '' for a built-in.
export const groupOf = (name: string, source: CommandSource, plugin?: string): string => {
  if (source === 'builtin') return ''
  if (source === 'user') return OWN
  const prefix = name.startsWith('mcp__') ? (name.split('__')[1] ?? '') : name.includes(':') ? (name.split(':')[0] ?? '') : ''
  if (source === 'mcp') return `MCP · ${prefix || 'servers'}`
  return plugin || prefix || 'Plugins'
}

// Your own commands and skills that share a name prefix with at least two others
// (firecrawl-search, firecrawl-scrape, ...) get a group of their own.
export const regroupOwn = (entries: CommandEntry[], min = 3): CommandEntry[] => {
  const keyOf = (name: string) => name.split('-')[0] ?? name
  const count = new Map<string, number>()
  const hyphenated = new Set<string>()
  for (const c of entries) {
    if (c.group !== OWN) continue
    const k = keyOf(c.name)
    count.set(k, (count.get(k) ?? 0) + 1)
    if (c.name.includes('-')) hyphenated.add(k)
  }
  return entries.map(c => {
    if (c.group !== OWN) return c
    const k = keyOf(c.name)
    return (count.get(k) ?? 0) >= min && hyphenated.has(k) ? { ...c, group: k } : c
  })
}

// Groups in display order: your own first, the rest by name.
export const sortGroups = (groups: string[]): string[] =>
  [...new Set(groups)].sort((a, b) => (a === OWN ? -1 : b === OWN ? 1 : a.localeCompare(b)))

// Inside a group the prefix it is named by can be dropped; the full name is what gets inserted.
export const labelIn = (group: string, name: string): string => (name.startsWith(`${group}:`) ? name.slice(group.length + 1) : name)

// The name a row shows: the real command while it fits the name column, else without its group prefix.
export const NAME_MAX = 30
export const displayName = (group: string, name: string): string => (name.length + 2 <= NAME_MAX ? name : labelIn(group, name))

// Keys of the pane's rows: `run|<section>|<name>` and `fav|<section>|<name>`.
export const nameOfKey = (key: string): string => {
  const parts = key.split('|')
  return (parts[0] === 'run' || parts[0] === 'fav') && parts.length >= 3 ? parts.slice(2).join('|') : ''
}

// The draft after a command is put in the prompt: `/name `, any text already typed after it.
export const draftWith = (name: string, draft: string): { text: string; cursor: number } => {
  const head = `/${name} `
  const rest = draft.trim()
  return { text: rest ? `${head}${rest}` : head, cursor: head.length }
}

export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

// Padded to `w` cells, or cut with an ellipsis.
export const fit = (s: string, w: number): string => (s.length <= w ? s.padEnd(w) : `${s.slice(0, Math.max(1, w - 1))}…`)

export const cut = (s: string, w: number): string => (s.length <= w ? s : `${s.slice(0, Math.max(1, w - 1))}…`)
