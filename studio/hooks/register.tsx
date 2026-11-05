import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type { CommandEntry, Explanation, Limit, ToolStep, TurnRecord, Usage } from '../types'
import { ESSENTIALS, NAME_MAX, cut, displayName, draftWith, fit, groupOf, nameOfKey, oneLine, regroupOwn, sortGroups } from './commands'
import { redactDeep, redactText } from './redact'

const rec = atom({ plugin: 'studio', key: 'rec' } as const, false)
const recWords = atom({ plugin: 'studio', key: 'recWords' } as const, [])
const usage = atom({ plugin: 'studio', key: 'usage' } as const, null)
const now = atom({ plugin: 'studio', key: 'now' } as const, 0)
const prompts = atom({ plugin: 'studio', key: 'prompts' } as const, 0)
const branch = atom({ plugin: 'studio', key: 'branch' } as const, '')
const project = atom({ plugin: 'studio', key: 'project' } as const, '')
const turns = atom({ plugin: 'studio', key: 'turns' } as const, [])
const ctxTrend = atom({ plugin: 'studio', key: 'ctxTrend' } as const, [])
const explains = atom({ plugin: 'studio', key: 'explains' } as const, [])
const view = atom({ plugin: 'studio', key: 'view' } as const, -1)
const busy = atom({ plugin: 'studio', key: 'busy' } as const, false)
const error = atom({ plugin: 'studio', key: 'error' } as const, '')
const termsLearned = atom({ plugin: 'studio', key: 'termsLearned' } as const, 0)
const collapsed = atom({ plugin: 'studio', key: 'collapsed' } as const, false)
const cmds = atom({ plugin: 'studio', key: 'cmds' } as const, [])
const cmdsListed = atom({ plugin: 'studio', key: 'cmdsListed' } as const, false)
const favs = atom({ plugin: 'studio', key: 'favs' } as const, [])
const openGroups = atom({ plugin: 'studio', key: 'openGroups' } as const, [])
const focused = atom({ plugin: 'studio', key: 'focused' } as const, '')

const PANE = 'studio-explain'
const CMD_PANE = 'studio-commands'
const STORE_REC = 'studio.rec'
const STORE_WORDS = 'studio.recWords'
const STORE_TERMS = 'studio.terms'
const STORE_COLLAPSED = 'studio.collapsed'
const STORE_FAVS = 'studio.favorites'

// ── formatting ────────────────────────────────────────────────────────────

const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

const short = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

const money = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const heat = (pct: number): 'success' | 'warning' | 'error' => (pct < 50 ? 'success' : pct < 80 ? 'warning' : 'error')

// Fixed twins of the theme's status colours for the Svg bar: an Svg is drawn as an image and reads no theme.
const HEAT_HEX = { success: '#3fb950', warning: '#d29922', error: '#f85149' } as const

const clampPct = (pct: number): number => Math.min(100, Math.max(0, pct))

// Terminal bar: a thin line, the used part in the heat colour.
const bar = (pct: number, width: number): [string, string] => {
  const p = clampPct(pct)
  const filled = p > 0 ? Math.max(1, Math.round((p / 100) * width)) : 0
  return ['━'.repeat(filled), '─'.repeat(width - filled)]
}

// Desktop bar: a slim rounded track, readable on light and dark themes.
const barSvg = (pct: number, px: number): string => {
  const p = clampPct(pct)
  const fill = p > 0 ? Math.max(6, Math.round((p / 100) * px)) : 0
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="6" viewBox="0 0 ${px} 6">`,
    `<rect width="${px}" height="6" rx="3" fill="#8b949e" fill-opacity="0.3"/>`,
    fill ? `<rect width="${fill}" height="6" rx="3" fill="${HEAT_HEX[heat(p)]}"/>` : '',
    '</svg>',
  ].join('')
}

const SPARK = '▁▂▃▄▅▆▇█'
const spark = (values: number[]): string =>
  values.map(v => SPARK[Math.min(7, Math.floor((Math.max(0, v) / 100) * 8))]).join('')

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const clockStamp = (ms: number): string => {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mm}`
}

const modelName = (id: string): string => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')

const basename = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? p

const shortPath = (p: string): string => {
  const parts = p.split('/').filter(Boolean)
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/')
}

// ── data ──────────────────────────────────────────────────────────────────

const snapshot = async ($: EngineInterface): Promise<Usage> => {
  const u = await $.session.usage()
  const limits: Limit[] = u.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null }))
  return {
    ctxPercent: u.context.percent ?? null,
    ctxTokens: u.context.tokens ?? null,
    window: u.context.window,
    limits,
    usd: u.cost?.usd ?? null,
    startedAt: u.startedAt,
  }
}

const refreshRepo = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  await update($, project, () => basename(cwd))
  try {
    const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 2000 })
    await update($, branch, () => (r.exitCode === 0 ? r.stdout.trim() : ''))
  } catch {
    await update($, branch, () => '')
  }
}

const targetOf = (e: Record<string, unknown>): string => {
  const pick = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'prompt']
  for (const k of pick) {
    const v = e[k]
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 90)
  }
  return ''
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const toolTally = (steps: ToolStep[]): string => {
  const counts = new Map<string, number>()
  for (const s of steps) {
    const name = (s.tool.startsWith('mcp__') ? s.tool.split('__').pop() : s.tool) ?? s.tool
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t))
    .join('  ')
}

// ── explain ───────────────────────────────────────────────────────────────

const explainPrompt = (turn: TurnRecord | undefined): string => {
  const activity = turn
    ? [
        `The person's last prompt: """${turn.prompt}"""`,
        `Tool calls recorded during the turn (${turn.tools.length}):`,
        ...turn.tools.slice(0, 40).map((t, i) => `${i + 1}. ${t.tool}${t.target ? ` — ${t.target}` : ''}`),
        turn.files.length ? `Files edited: ${turn.files.join(', ')}` : 'No files edited.',
        `Turn took ${dur(turn.durationMs)}.`,
        `The assistant's final reply (may be cut): """${turn.answer.slice(0, 4000)}"""`,
      ].join('\n')
    : 'No turn activity was recorded; use the conversation itself.'

  return [
    'Write a short recap card for the person driving this Claude Code session.',
    'Cover ONLY the most recent user prompt and what the assistant did in response to it.',
    'Audience: a smart creator who is not a software engineer. Plain English. Concrete, compressed, no filler.',
    'Do not call any tools. Reply with ONLY one JSON object, no code fences, no prose around it:',
    '{"title": "max 8 words",',
    ' "tldr": "1-2 sentences: what changed and the outcome",',
    ' "steps": ["3-7 items, each max 16 words, past tense, action + result"],',
    ' "why": "1-2 sentences on the approach / reasoning",',
    ' "terms": [{"term": "a technical word actually used", "meaning": "max 18 words, an everyday analogy is welcome"}],',
    ' "risk": "anything irreversible, risky or still unverified; empty string if none",',
    ' "next": "what the person should do now, or \\"Nothing — all done.\\""}',
    'Use 0-4 terms. Never include secrets, keys or personal data.',
    '',
    activity,
  ].join('\n')
}

const parseExplanation = (text: string, turnId: string, tokens: number, at: number): Explanation => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as Partial<Explanation>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    return {
      turnId,
      title: str(j.title) || 'Last turn',
      tldr: str(j.tldr),
      steps: Array.isArray(j.steps) ? j.steps.map(str).filter(Boolean).slice(0, 8) : [],
      why: str(j.why),
      terms: Array.isArray(j.terms)
        ? j.terms
            .map(t => ({ term: str(t?.term), meaning: str(t?.meaning) }))
            .filter(t => t.term && t.meaning)
            .slice(0, 5)
        : [],
      risk: str(j.risk),
      next: str(j.next),
      createdAt: at,
      tokens,
    }
  } catch {
    return { turnId, title: 'Last turn', tldr: text.trim().slice(0, 1200), steps: [], why: '', terms: [], risk: '', next: '', createdAt: at, tokens }
  }
}

const learnTerms = async ($: EngineInterface, ex: Explanation) => {
  const known = new Set(((await $.store.get(STORE_TERMS)) as string[] | undefined) ?? [])
  for (const t of ex.terms) known.add(t.term.toLowerCase())
  await $.store.set(STORE_TERMS, [...known].slice(-2000))
  await update($, termsLearned, () => known.size)
}

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Explain', focus: true, rows: 34, columns: 76 })

const explainLatest = async ($: EngineInterface) => {
  await openPane($)
  if (await read($, busy)) return
  await update($, busy, () => true)
  await update($, error, () => '')
  try {
    const list = await read($, turns)
    const turn = list[list.length - 1]
    const already = (await read($, explains)).findIndex(x => turn && x.turnId === turn.id)
    if (already >= 0) {
      await update($, view, () => already)
      return
    }
    const r = await $.model.fork({ prompt: explainPrompt(turn) })
    if (!r.isAnswered) {
      const why =
        r.reason === 'nothing-to-fork'
          ? 'Nothing to explain yet — send a prompt first.'
          : r.reason === 'api-error'
            ? `The model call failed (${r.error}${r.status ? `, ${r.status}` : ''}).`
            : r.reason === 'aborted'
              ? 'The explanation was interrupted.'
              : 'The model returned no text.'
      await update($, error, () => why)
      return
    }
    const fresh = r.usage.input_tokens + r.usage.output_tokens + r.usage.cache_creation_input_tokens
    const ex = parseExplanation(r.text, turn?.id ?? 'session', fresh, await $.clock.now())
    let index = 0
    await update($, explains, xs => {
      const next = [...xs, ex].slice(-30)
      index = next.length - 1
      return next
    })
    await update($, view, () => index)
    await learnTerms($, ex)
  } finally {
    await update($, busy, () => false)
  }
}

const setRec = async ($: EngineInterface, on: boolean) => {
  await update($, rec, () => on)
  await $.store.set(STORE_REC, on)
  $.ui.status(on ? '● REC — screen masking on' : undefined)
  $.ui.toast(on ? '● REC on — secrets, emails and paths are masked on screen' : 'REC off')
}

// Remembered in the store, so a minimized HUD stays minimized in every session.
const setCollapsed = async ($: EngineInterface, on: boolean) => {
  await update($, collapsed, () => on)
  await $.store.set(STORE_COLLAPSED, on)
}

// ── commands cheat sheet ──────────────────────────────────────────────────

const loadCommands = async ($: EngineInterface) => {
  try {
    const list = await $.command.list()
    const entries: CommandEntry[] = regroupOwn(
      list.map(c => ({
        name: c.name,
        description: oneLine(c.description ?? ''),
        source: c.source,
        group: groupOf(c.name, c.source, c.plugin),
      })),
    )
    await update($, cmds, () => entries)
    await update($, cmdsListed, () => true)
  } catch {
    await update($, cmdsListed, () => false)
  }
}

const openCommands = async ($: EngineInterface) => {
  await loadCommands($)
  // A picker: it takes the keys (the arrows walk its rows), Esc closes it, toasts wait behind it.
  await $.ui.open({ id: CMD_PANE, title: 'Commands', focus: true, closeOnEscape: true, holdToasts: true, rows: 34, columns: 76 })
}

// Puts `/name ` in the prompt and closes the pane; a draft already typed stays after it.
// Where the surface keeps its own prompt box, the command goes to the clipboard instead.
const insertCommand = async ($: EngineInterface, name: string, surface: RenderSurface) => {
  await $.ui.close({ id: CMD_PANE })
  const box = await $.prompt.read()
  const r = await $.prompt.fill(draftWith(name, box.text))
  if (r.isFilled) return
  try {
    await $.ui.copy({ surface, text: `/${name} ` })
    $.ui.toast(`Copied /${name} - paste it into the prompt`)
  } catch {
    $.ui.toast(`Type /${name} in the prompt`)
  }
}

// Remembered in the store, so favorites stay pinned in every session.
const toggleFav = async ($: EngineInterface, name: string) => {
  if (!name) return
  let next: string[] = []
  await update($, favs, xs => {
    next = xs.includes(name) ? xs.filter(x => x !== name) : [...xs, name]
    return next
  })
  await $.store.set(STORE_FAVS, next)
}

const toggleGroup = ($: EngineInterface, group: string) =>
  update($, openGroups, xs => (xs.includes(group) ? xs.filter(x => x !== group) : [...xs, group]))

// ── hooks ─────────────────────────────────────────────────────────────────

export const register: Register = on => {
  let current: { prompt: string; startedAt: number; usdBefore: number; tools: ToolStep[]; files: Set<string> } | null = null

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'rec', description: 'Toggle REC mode (mask secrets on screen). /rec hide <text> · /rec show <text> · /rec list' })
    await $.command.register({ name: 'explain', description: 'Recap the last turn in the Explain pane' })
    await $.command.register({ name: 'hud', description: 'Minimize or expand the studio HUD. /hud min · /hud max' })
    try {
      await $.command.register({ name: 'commands', description: 'Open the studio cheat sheet of slash commands and shortcuts' })
    } catch {}
    const storedFavs = ((await $.store.get(STORE_FAVS)) as unknown[] | undefined) ?? []
    await update($, favs, () => storedFavs.filter((x): x is string => typeof x === 'string'))
    const storedCollapsed = (await $.store.get(STORE_COLLAPSED)) === true
    await update($, collapsed, () => storedCollapsed)
    const storedRec = (await $.store.get(STORE_REC)) === true
    const words = ((await $.store.get(STORE_WORDS)) as string[] | undefined) ?? []
    const terms = ((await $.store.get(STORE_TERMS)) as string[] | undefined) ?? []
    await update($, rec, () => storedRec)
    await update($, recWords, () => words)
    await update($, termsLearned, () => terms.length)
    if (storedRec) $.ui.status('● REC — screen masking on')
    await update($, usage, () => null)
    try {
      const snap = await snapshot($)
      await update($, usage, () => snap)
    } catch {}
    await update($, now, () => 0)
    const tick = async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    }
    await tick()
    await refreshRepo($)
    $.clock.every(30_000, () => void tick())
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    const t = await $.clock.now()
    await update($, usage, u => ({
      ctxPercent: e.context.percent ?? null,
      ctxTokens: e.context.tokens ?? null,
      window: e.context.window,
      limits: e.rateLimits.map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt ?? null })),
      usd: e.cost?.usd ?? null,
      startedAt: u?.startedAt ?? t,
    }))
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined) {
      const u = await read($, usage)
      current = { prompt: e.text.slice(0, 600), startedAt: await $.clock.now(), usdBefore: u?.usd ?? 0, tools: [], files: new Set() }
      await update($, prompts, n => n + 1)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (current && e.agentId === undefined) {
      const input = e as unknown as Record<string, unknown>
      current.tools.push({ tool: String(e.tool), target: targetOf(input) })
      const file = input.file_path ?? input.notebook_path
      if (EDIT_TOOLS.has(String(e.tool)) && typeof file === 'string') current.files.add(shortPath(file))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    const u = e.usage
    const totalIn = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    let snap: Usage | null = null
    try {
      snap = await snapshot($)
      await update($, usage, () => snap)
    } catch {}
    const record: TurnRecord = {
      id: e.turnId,
      prompt: current?.prompt ?? '',
      answer: e.answer,
      tools: current?.tools ?? [],
      files: [...(current?.files ?? [])],
      durationMs: e.durationMs,
      model: modelName(u?.model ?? (await $.session.model())),
      // -1: the mod did not see this turn start, so its own cost is unknown
      usd: current && snap?.usd != null ? Math.max(0, snap.usd - current.usdBefore) : -1,
      cacheHit: u && totalIn > 0 ? Math.round((u.cache_read_input_tokens / totalIn) * 100) : null,
      endedAt: await $.clock.now(),
    }
    current = null
    await update($, turns, xs => [...xs, record].slice(-30))
    if (snap?.ctxPercent != null) await update($, ctxTrend, xs => [...xs, snap!.ctxPercent as number].slice(-16))
    const t = await $.clock.now()
    await update($, now, () => t)
    await refreshRepo($)
    if (e.durationMs > 120_000 && !e.isAborted) $.ui.toast(`Done in ${dur(e.durationMs)} — press ctrl+x tab, then e to explain`)
    return r
  })

  on('command.run', { command: 'explain' }, async $ => {
    await explainLatest($)
    const err = await read($, error)
    return { text: err || 'Recap ready in the Explain pane.' }
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    const target = verb === 'min' ? true : verb === 'max' ? false : !(await read($, collapsed))
    await setCollapsed($, target)
    return { text: target ? 'HUD minimized.' : 'HUD expanded.' }
  })

  on('command.run', { command: 'rec' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    const word = rest.join(' ').trim()
    const words = await read($, recWords)
    if (verb === 'hide' && word) {
      const next = [...new Set([...words, word])]
      await update($, recWords, () => next)
      await $.store.set(STORE_WORDS, next)
      return { text: `REC will also mask that term (${next.length} custom terms).` }
    }
    if (verb === 'show' && word) {
      const next = words.filter(w => w.toLowerCase() !== word.toLowerCase())
      await update($, recWords, () => next)
      await $.store.set(STORE_WORDS, next)
      return { text: `Removed. ${next.length} custom terms left.` }
    }
    if (verb === 'list') return { text: words.length ? `${words.length} custom masked terms (not shown on purpose).` : 'No custom masked terms.' }
    const target = verb === 'on' ? true : verb === 'off' ? false : !(await read($, rec))
    await setRec($, target)
    return { text: target ? 'REC on.' : 'REC off.' }
  })

  on('command.run', { command: 'commands' }, async $ => {
    await openCommands($)
    return { text: 'Commands pane opened.' }
  })

  // Remember which row of the Commands pane holds the ring, so F stars it.
  // The Star button itself never takes over, so F acts on the row the ring was on.
  on('ui.focus', { requestId: CMD_PANE }, async ($, e, next) => {
    const r = await next(e)
    if (e.element !== 'star') await update($, focused, () => e.element ?? '')
    if (e.element) await $.ui.scroll({ to: { key: e.element }, in: CMD_PANE }).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  // ── REC: mask what the transcript draws ─────────────────────────────────

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) =>
    (await read($, rec)) ? next({ ...e, props: { ...e.props, text: redactText(e.props.text, await read($, recWords)) } }) : next(e),
  )

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) =>
    (await read($, rec)) ? next({ ...e, props: { ...e.props, text: redactText(e.props.text, await read($, recWords)) } }) : next(e),
  )

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, rec))) return next(e)
    const w = await read($, recWords)
    return next({
      ...e,
      props: { ...e.props, input: redactDeep(e.props.input, w), ...(e.props.output === undefined ? {} : { output: redactDeep(e.props.output, w) }) },
    })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) =>
    (await read($, rec)) ? next({ ...e, props: { ...e.props, output: redactDeep(e.props.output, await read($, recWords)) } }) : next(e),
  )

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, rec))) return next(e)
    const w = await read($, recWords)
    return next({
      ...e,
      props: {
        ...e.props,
        calls: e.props.calls.map(c => ({ ...c, input: redactDeep(c.input, w), ...(c.output === undefined ? {} : { output: redactDeep(c.output, w) }) })),
      },
    })
  })

  // ── HUD above the prompt ────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg

    const u = await read($, usage)
    const t = await read($, now)
    const list = await read($, turns)
    const last = list[list.length - 1]
    const isRec = await read($, rec)
    const n = await read($, prompts)
    const proj = await read($, project)
    const br = await read($, branch)
    const trend = await read($, ctxTrend)
    const isCollapsed = await read($, collapsed)

    const five = u?.limits.find(l => l.kind === 'five_hour')
    const week = u?.limits.find(l => l.kind === 'seven_day')
    const spend = u?.limits.find(l => l.kind === 'spend_limit')
    const resetIn = (l: Limit) => (l.resetsAt ? `resets in ${short(Date.parse(l.resetsAt) - t)}` : '')

    const buttons = (
      <Box flexDirection="row" gap={1}>
        <Button
          key="rec"
          hotkey="r"
          label={isRec ? '● REC' : '○ REC'}
          variant={isRec ? 'primary' : 'secondary'}
          onPress={() => setRec($, !isRec)}
        />
        <Button key="explain" hotkey="e" label="✦ Explain" onPress={() => explainLatest($)} />
        <Button key="commands" hotkey="c" label="⌘ Commands" onPress={() => openCommands($)} />
        <Button
          key="collapse"
          hotkey="m"
          label={isCollapsed ? '▸ Expand' : '▾ Minimize'}
          onPress={() => setCollapsed($, !isCollapsed)}
        />
      </Box>
    )

    // Minimized: one row with the numbers only, no bars, cards or last-turn line.
    if (isCollapsed) {
      const pct = (label: string, p: number | null | undefined) =>
        p == null ? null : (
          <Text key={label} color={p >= 50 ? heat(clampPct(p)) : undefined}>
            <Text dimColor>{`${label} `}</Text>
            {`${Math.round(clampPct(p))}%`}
          </Text>
        )
      const facts = [
        pct('CTX', u?.ctxPercent),
        pct('5H', five?.percent),
        pct('WEEK', week?.percent),
        pct('SPEND', spend?.percent),
        u?.usd != null ? <Text key="usd">{money(u.usd)}</Text> : null,
      ].filter(Boolean)
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1}>
          <Box flexDirection="row" gap={2} flexShrink={1}>
            <Text bold wrap="truncate-end">
              {proj || 'Session'}
            </Text>
            {facts}
          </Box>
          {buttons}
        </Box>
      )
    }

    // Layout: a header, one card per metric sharing the width, a footer for the last turn.
    const GAP = 3
    const inner = e.props.bodyColumns - 2
    const cardCount = 2 + (five ? 1 : 0) + (week ? 1 : 0) + (spend ? 1 : 0)
    const cardW = Math.max(18, Math.min(30, Math.floor((inner - GAP * (cardCount - 1)) / cardCount)))
    const barW = cardW - 6
    // Blank rows between the sections, dropped when the band is short of room.
    const air = e.props.maxRows >= 7 ? 1 : 0

    const card = (label: string, value: RenderElement, detail: RenderElement | string) => (
      <Box flexDirection="column" width={cardW}>
        <Text dimColor bold>
          {label}
        </Text>
        {value}
        {typeof detail === 'string' ? (
          <Text dimColor wrap="truncate-end">
            {detail || ' '}
          </Text>
        ) : (
          detail
        )}
      </Box>
    )

    const meter = (pct: number | null) => {
      const p = clampPct(pct ?? 0)
      const label = pct == null ? '—' : `${Math.round(p)}%`
      const [full, empty] = bar(p, barW)
      return (
        <Box flexDirection="row" alignItems="center">
          {Svg ? (
            <Svg source={barSvg(p, barW * 6)} alt={`${label} used`} width={barW * 6} height={6} />
          ) : (
            <Box flexDirection="row">
              <Text color={heat(p)}>{full}</Text>
              <Text dimColor>{empty}</Text>
            </Box>
          )}
          <Text bold color={p >= 50 ? heat(p) : undefined}>
            {' '}
            {label}
          </Text>
        </Box>
      )
    }

    const ctxText = u?.ctxTokens != null ? `${tokens(u.ctxTokens)} of ${tokens(u.window)}` : ''
    const sparkRoom = cardW - ctxText.length - 2
    const ctxDetail = (
      <Box flexDirection="row">
        <Text dimColor>{ctxText || ' '}</Text>
        {trend.length > 1 && sparkRoom >= 4 ? <Text color="suggestion">{`  ${spark(trend.slice(-sparkRoom))}`}</Text> : null}
      </Box>
    )

    const elapsed = u ? short(t - u.startedAt) : ''
    const session = [elapsed, `${n} ${n === 1 ? 'prompt' : 'prompts'}`].filter(Boolean).join(' · ')

    const turnFacts = last
      ? [
          dur(last.durationMs),
          last.usd > 0 ? money(last.usd) : '',
          last.model,
          last.cacheHit != null ? `cache ${last.cacheHit}%` : '',
          `${last.tools.length} tool ${last.tools.length === 1 ? 'call' : 'calls'}${last.tools.length ? ` (${toolTally(last.tools)})` : ''}`,
          last.files.length ? `${last.files.length} ${last.files.length === 1 ? 'file' : 'files'} edited` : '',
        ]
          .filter(Boolean)
          .join('  ·  ')
      : ''

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" flexShrink={1}>
            <Text bold wrap="truncate-end">
              {proj || 'Session'}
            </Text>
            {br ? (
              <Text color="success" wrap="truncate-end">
                {'   ⎇ '}
                {br}
              </Text>
            ) : null}
          </Box>
          {buttons}
        </Box>

        <Box flexDirection="row" flexWrap="wrap" columnGap={GAP} rowGap={air} marginTop={air}>
          {card('CONTEXT', meter(u?.ctxPercent ?? null), ctxDetail)}
          {five ? card('5-HOUR LIMIT', meter(five.percent), resetIn(five)) : null}
          {week ? card('WEEKLY LIMIT', meter(week.percent), resetIn(week)) : null}
          {spend ? card('SPEND LIMIT', meter(spend.percent), '') : null}
          {card('SESSION', <Text bold>{u?.usd != null ? money(u.usd) : '—'}</Text>, session)}
        </Box>

        <Box flexDirection="row" marginTop={air}>
          <Text dimColor bold>
            {'LAST TURN   '}
          </Text>
          <Text dimColor={!last} wrap="truncate-end">
            {last ? turnFacts : 'waiting for the first prompt'}
          </Text>
        </Box>
      </Box>
    )
  })

  // ── Explain pane ────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const xs = await read($, explains)
    const i = await read($, view)
    const isBusy = await read($, busy)
    const err = await read($, error)
    const isRec = await read($, rec)
    const words = await read($, recWords)
    const learned = await read($, termsLearned)
    const list = await read($, turns)
    const proj = await read($, project)
    const cols = e.props.bodyColumns
    const mask = (s: string) => (isRec ? redactText(s, words) : s)
    const rule = <Text dimColor>{'─'.repeat(Math.max(10, Math.min(cols - 2, 60)))}</Text>
    const ex = xs[i]
    const turn = ex ? list.find(t => t.id === ex.turnId) : undefined

    const heading = (icon: string, label: string, color: string) => (
      <Box marginTop={1}>
        <Text color={color} bold>
          {icon} {label}
        </Text>
      </Box>
    )

    const nav = (
      <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
        <Button key="older" hotkey="p" label="◀ Older" dimColor={i <= 0} onPress={() => void update($, view, v => Math.max(0, v - 1))} />
        <Button key="newer" hotkey="n" label="Newer ▶" dimColor={i >= xs.length - 1} onPress={() => void update($, view, v => Math.min(xs.length - 1, v + 1))} />
        <Button key="again" hotkey="e" label="↻ Explain latest" variant="primary" onPress={() => explainLatest($)} />
        {ex ? (
          <Button
            key="copy"
            hotkey="c"
            label="⧉ Copy"
            onPress={p =>
              void $.ui.copy({
                surface: p.surface,
                text: mask(
                  [`# ${ex.title}`, ex.tldr, '', ...ex.steps.map((s, k) => `${k + 1}. ${s}`), '', `Why: ${ex.why}`, ex.next ? `Next: ${ex.next}` : '']
                    .filter(l => l !== undefined)
                    .join('\n'),
                ),
              })
            }
          />
        ) : null}
        <Button key="close" hotkey="x" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
      </Box>
    )

    if (!ex) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="claude" bold>
            ✦ EXPLAIN
          </Text>
          <Box marginTop={1}>
            <Text dimColor>{isBusy ? 'Reading the last turn and compressing it…' : err || 'No recap yet. Press ↻ Explain latest after a turn.'}</Text>
          </Box>
          {nav}
        </Box>
      )
    }

    const stamp = clockStamp(ex.createdAt)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="claude" bold>
            ✦ EXPLAIN
          </Text>
          <Text dimColor>
            {i + 1} of {xs.length}
          </Text>
        </Box>
        <Text bold>{mask(ex.title)}</Text>
        <Text dimColor>
          {proj ? `${proj} · ` : ''}
          {stamp}
          {turn ? ` · ${dur(turn.durationMs)}${turn.usd > 0 ? ` · ${money(turn.usd)}` : ''}` : ''}
        </Text>
        {isBusy ? <Text color="suggestion">↻ explaining the newest turn…</Text> : null}
        {err ? <Text color="error">{err}</Text> : null}

        {heading('◆', 'TL;DR', 'suggestion')}
        <Text>{mask(ex.tldr)}</Text>

        {ex.steps.length ? (
          <Box flexDirection="column">
            {heading('▸', 'WHAT HAPPENED', 'warning')}
            {ex.steps.map((s, k) => (
              <Box flexDirection="row">
                <Text color="warning" bold>
                  {String(k + 1).padStart(2)}{' '}
                </Text>
                <Text>{mask(s)}</Text>
              </Box>
            ))}
          </Box>
        ) : null}

        {ex.why ? (
          <Box flexDirection="column">
            {heading('?', 'WHY', 'success')}
            <Text>{mask(ex.why)}</Text>
          </Box>
        ) : null}

        {ex.terms.length ? (
          <Box flexDirection="column">
            {heading('≡', 'TERMS', 'permission')}
            {ex.terms.map(t => (
              <Box flexDirection="row">
                <Text color="permission" bold>
                  {mask(t.term)}
                </Text>
                <Text dimColor> — </Text>
                <Text>{mask(t.meaning)}</Text>
              </Box>
            ))}
          </Box>
        ) : null}

        {ex.risk ? (
          <Box flexDirection="column">
            {heading('!', 'WATCH OUT', 'error')}
            <Text>{mask(ex.risk)}</Text>
          </Box>
        ) : null}

        {heading('✓', 'DO NEXT', 'success')}
        <Text>{mask(ex.next || 'Nothing — all done.')}</Text>

        <Box marginTop={1}>{rule}</Box>
        {turn && turn.tools.length ? (
          <Text dimColor wrap="truncate-end">
            tools {toolTally(turn.tools)}
            {turn.files.length ? `  ·  files ${mask(turn.files.slice(0, 4).join(', '))}${turn.files.length > 4 ? ` +${turn.files.length - 4}` : ''}` : ''}
          </Text>
        ) : null}
        <Text dimColor>
          terms learned {learned} · recap cost {tokens(ex.tokens)} new tokens
        </Text>
        {nav}
      </Box>
    )
  })

  // ── Commands pane ───────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: CMD_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, cmds)
    const isListed = await read($, cmdsListed)
    const fav = await read($, favs)
    const open = await read($, openGroups)
    const foc = await read($, focused)
    const cols = e.props.bodyColumns
    const isTerminal = e.surface === 'terminal'

    const byName = new Map(all.map(c => [c.name, c]))
    // Until the session has listed its commands, show the whole sheet.
    const has = (name: string) => !isListed || byName.has(name)
    const essentials = ESSENTIALS.filter(x => !x.cmd || has(x.cmd))
    const essentialText = new Map(ESSENTIALS.filter(x => x.cmd).map(x => [x.cmd as string, x.text]))
    const favRows = fav.filter(has).map(name => ({ name, text: essentialText.get(name) ?? byName.get(name)?.description ?? '' }))

    const own = all.filter(c => c.source !== 'builtin')
    const groups = sortGroups(own.map(c => c.group))
    const openLabels = own.filter(c => open.includes(c.group)).map(c => displayName(c.group, c.name))

    // One name column for the whole pane; the description takes the rest of the row.
    const shown = [...favRows.map(r => r.name), ...essentials.map(x => x.cmd ?? x.keys ?? ''), ...openLabels]
    const nameW = Math.min(NAME_MAX, Math.max(12, ...shown.map(n => n.length + 2)))
    const descW = Math.max(8, cols - nameW - 6)

    const heading = (icon: string, label: string, color: string, aside?: string) => (
      <Box marginTop={1} flexDirection="row">
        <Text color={color} bold>
          {icon} {label}
        </Text>
        {aside ? <Text dimColor>{`  ${aside}`}</Text> : null}
      </Box>
    )

    const row = (section: string, name: string, text: string, label = name) => {
      const isFav = fav.includes(name)
      return (
        <Box flexDirection="row">
          <Box width={nameW} flexShrink={0}>
            <Button key={`run|${section}|${name}`} label={cut(`/${label}`, nameW - 1)} plain onPress={p => void insertCommand($, name, p.surface)} />
          </Box>
          <Text dimColor wrap="truncate-end">
            {cut(text, descW)}
          </Text>
          <Text> </Text>
          <Button key={`fav|${section}|${name}`} plain dimColor={!isFav} label={isFav ? '★' : '☆'} onPress={() => void toggleFav($, name)} />
        </Box>
      )
    }

    const essentialGroups = [...new Set(essentials.map(x => x.group))]
    const focusedName = nameOfKey(foc)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="claude" bold>
            ⌘ COMMANDS
          </Text>
          <Text dimColor>{isListed ? `${all.length} available` : ''}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {isTerminal ? '↑↓ move · Enter puts it in the prompt · F stars · Esc closes' : 'Click a command to put it in the prompt · ☆ pins it to the top'}
        </Text>

        {heading('★', 'FAVORITES', 'warning')}
        {favRows.length ? (
          favRows.map(r => row('f', r.name, r.text))
        ) : (
          <Text dimColor>{isTerminal ? 'Nothing pinned yet. Press F on a command, or Enter on its ☆.' : 'Nothing pinned yet. Click ☆ next to a command.'}</Text>
        )}

        {heading('◆', 'ESSENTIALS', 'suggestion')}
        {essentialGroups.map(g => (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor bold>
              {g.toUpperCase()}
            </Text>
            {essentials
              .filter(x => x.group === g)
              .map(x =>
                x.cmd ? (
                  row('e', x.cmd, x.text)
                ) : (
                  <Box flexDirection="row">
                    <Text color="permission">{fit(x.keys ?? '', nameW)}</Text>
                    <Text dimColor>{cut(x.text, descW)}</Text>
                  </Box>
                ),
              )}
          </Box>
        ))}

        {heading('▸', 'YOUR COMMANDS', 'success', isListed ? `${own.length} from your plugins, skills and MCP` : '')}
        {!isListed ? <Text dimColor>Couldn’t read the commands of this session.</Text> : null}
        {isListed && !own.length ? <Text dimColor>No plugin, skill or MCP commands installed yet.</Text> : null}
        {groups.map(g => {
          const items = own.filter(c => c.group === g).sort((a, b) => a.name.localeCompare(b.name))
          const isOpen = open.includes(g)
          return (
            <Box flexDirection="column">
              <Button key={`grp|${g}`} label={`${isOpen ? '▾' : '▸'} ${g} (${items.length})`} plain onPress={() => void toggleGroup($, g)} />
              {isOpen ? (
                <Box flexDirection="column" paddingLeft={2}>
                  {items.map(c => row('y', c.name, c.description, displayName(g, c.name)))}
                </Box>
              ) : null}
            </Box>
          )
        })}

        <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Button
            key="star"
            hotkey="f"
            label={focusedName && fav.includes(focusedName) ? '☆ Unstar' : '★ Star'}
            dimColor={!focusedName}
            onPress={() => void read($, focused).then(k => toggleFav($, nameOfKey(k)))}
          />
          <Button key="close" hotkey="x" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: CMD_PANE })} />
        </Box>
      </Box>
    )
  })
}
