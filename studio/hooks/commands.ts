import type { CommandEntry, CommandSource } from '../types'

// ── Commands pane: the data and pure helpers (the hooks live in register.tsx) ──

// The built-ins worth remembering, checked against code.claude.com/docs/en/commands
// and /desktop (Nov 2026). A command shows only when the session lists it.
export type Essential = { group: string; cmd: string; text: string }

export const ESSENTIAL_GROUPS = ['Power tools', 'Everyday', 'Model & speed', 'Setup', 'Other devices'] as const

// Open when the pane first opens; the person's own choice is remembered after that.
export const ESSENTIAL_OPEN: string[] = ['Power tools', 'Everyday']

export const ESSENTIALS: Essential[] = [
  { group: 'Power tools', cmd: 'advisor', text: 'A second model advises mid-task (on/off)' },
  { group: 'Power tools', cmd: 'code-review', text: 'Find bugs in your current changes' },
  { group: 'Power tools', cmd: 'security-review', text: 'Check your changes for security issues' },
  { group: 'Power tools', cmd: 'simplify', text: 'Clean up changed code and apply the fixes' },
  { group: 'Power tools', cmd: 'doctor', text: 'Check your setup and fix what is wrong' },
  { group: 'Power tools', cmd: 'insights', text: 'Report on your sessions + features to try' },
  { group: 'Power tools', cmd: 'goal', text: 'Keep working until a condition is met' },
  { group: 'Power tools', cmd: 'loop', text: 'Repeat a prompt on an interval' },
  { group: 'Power tools', cmd: 'schedule', text: 'Run Claude on a schedule in the cloud' },
  { group: 'Everyday', cmd: 'clear', text: 'Start fresh with an empty context' },
  { group: 'Everyday', cmd: 'compact', text: 'Summarize the chat to free up context' },
  { group: 'Everyday', cmd: 'context', text: 'See what fills your context window' },
  { group: 'Everyday', cmd: 'btw', text: 'Side question that stays out of the chat' },
  { group: 'Everyday', cmd: 'rewind', text: 'Undo: roll chat and code back (or Esc Esc)' },
  { group: 'Everyday', cmd: 'resume', text: 'Go back to an earlier conversation' },
  { group: 'Everyday', cmd: 'branch', text: 'Try another direction, keep the original' },
  { group: 'Everyday', cmd: 'copy', text: 'Copy Claude’s last answer' },
  { group: 'Everyday', cmd: 'tasks', text: 'See background work and finished agents' },
  { group: 'Model & speed', cmd: 'model', text: 'Switch model (arrows set effort)' },
  { group: 'Model & speed', cmd: 'effort', text: 'How hard Claude thinks: low to max' },
  { group: 'Model & speed', cmd: 'fast', text: 'Turn fast mode on or off' },
  { group: 'Model & speed', cmd: 'plan', text: 'Plan first, change nothing until you approve' },
  { group: 'Model & speed', cmd: 'usage', text: 'Session cost and your plan limits' },
  { group: 'Setup', cmd: 'init', text: 'Create a CLAUDE.md guide for this project' },
  { group: 'Setup', cmd: 'memory', text: 'Edit CLAUDE.md files and auto memory' },
  { group: 'Setup', cmd: 'skills', text: 'List your skills' },
  { group: 'Setup', cmd: 'mcp', text: 'Manage connected MCP servers' },
  { group: 'Setup', cmd: 'plugin', text: 'Install and manage plugins' },
  { group: 'Setup', cmd: 'reload-plugins', text: 'Load plugin changes without restarting' },
  { group: 'Setup', cmd: 'hooks', text: 'See your hook configurations' },
  { group: 'Setup', cmd: 'statusline', text: 'Set up the status line' },
  { group: 'Other devices', cmd: 'remote-control', text: 'Reach this session from claude.ai' },
  { group: 'Other devices', cmd: 'teleport', text: 'Pull a cloud session into this terminal' },
  { group: 'Other devices', cmd: 'desktop', text: 'Continue this session in the desktop app' },
  { group: 'Other devices', cmd: 'mobile', text: 'Get the Claude mobile app (QR code)' },
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
