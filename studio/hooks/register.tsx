import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Explanation, Limit, ToolStep, TurnRecord, Usage } from '../types'
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

const PANE = 'studio-explain'
const STORE_REC = 'studio.rec'
const STORE_WORDS = 'studio.recWords'
const STORE_TERMS = 'studio.terms'

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

// ── hooks ─────────────────────────────────────────────────────────────────

export const register: Register = on => {
  let current: { prompt: string; startedAt: number; usdBefore: number; tools: ToolStep[]; files: Set<string> } | null = null

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'rec', description: 'Toggle REC mode (mask secrets on screen). /rec hide <text> · /rec show <text> · /rec list' })
    await $.command.register({ name: 'explain', description: 'Recap the last turn in the Explain pane' })
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

    const five = u?.limits.find(l => l.kind === 'five_hour')
    const week = u?.limits.find(l => l.kind === 'seven_day')
    const spend = u?.limits.find(l => l.kind === 'spend_limit')
    const resetIn = (l: Limit) => (l.resetsAt ? `resets in ${short(Date.parse(l.resetsAt) - t)}` : '')

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
          <Box flexDirection="row" gap={1}>
            <Button
              key="rec"
              hotkey="r"
              label={isRec ? '● REC' : '○ REC'}
              variant={isRec ? 'primary' : 'secondary'}
              onPress={() => setRec($, !isRec)}
            />
            <Button key="explain" hotkey="e" label="✦ Explain" onPress={() => explainLatest($)} />
          </Box>
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
}
