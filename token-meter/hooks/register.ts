import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { Usage } from '../types'

// API list prices in USD per million tokens. Cache writes are priced at the
// 1-hour TTL (2x input), which is what Claude Code sessions use.
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

const PRICES: ReadonlyArray<[string, Price]> = [
  ['fable', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 }],
  ['mythos', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 }],
  ['opus-5-5', { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 }],
  ['opus', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 }],
  ['sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 }],
  ['sonnet-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 }],
  ['sonnet', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 }],
  ['haiku', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 }],
]

const DEFAULT_PRICE: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 }

const EMPTY: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, turns: 0 }

const last = atom({ plugin: 'token-meter', key: 'last' } as const, null)
const session = atom({ plugin: 'token-meter', key: 'session' } as const, EMPTY)
const pending = atom({ plugin: 'token-meter', key: 'pending' } as const, EMPTY)

export const priceFor = (model: string): Price =>
  PRICES.find(([name]) => model.includes(name))?.[1] ?? DEFAULT_PRICE

export const toUsage = (u: TurnUsage): Usage => {
  const p = priceFor(u.model)
  const usd =
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_read_input_tokens * p.cacheRead +
      u.cache_creation_input_tokens * p.cacheWrite) /
    1e6

  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheWrite: u.cache_creation_input_tokens,
    usd,
    turns: 1,
  }
}

export const add = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  usd: a.usd + b.usd,
  turns: a.turns + b.turns,
})

const tokens = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite

const short = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`

const usd = (n: number) => `$${n.toFixed(2)}`

// Share of the prompt that came from the cache: high means cheap.
const cacheShare = (u: Usage) => {
  const prompt = u.input + u.cacheRead + u.cacheWrite
  return prompt === 0 ? 0 : Math.round((u.cacheRead / prompt) * 100)
}

export const statusText = (lastPrompt: Usage | null, total: Usage) =>
  lastPrompt === null
    ? `Session: ${short(tokens(total))} tok · ~${usd(total.usd)}`
    : `Last: ${short(tokens(lastPrompt))} tok · ~${usd(lastPrompt.usd)} (cache ${cacheShare(lastPrompt)}%) | Session: ~${usd(total.usd)}`

const lines = (label: string, u: Usage) => [
  `${label}: ~${usd(u.usd)}`,
  `  cache read: ${short(u.cacheRead)} · cache write: ${short(u.cacheWrite)}`,
  `  uncached input: ${short(u.input)} · output: ${short(u.output)}`,
  `  from cache: ${cacheShare(u)}% of the prompt`,
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'token-cost',
      description: 'Tokens and estimated cost of the last prompt and the whole session',
    })
    $.ui.status(statusText(await read($, last), await read($, session)))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage === undefined) {
      return next(e)
    }

    const spent = toUsage(e.usage)
    const total = await update($, session, s => add(s, spent))

    if (e.agentId !== undefined) {
      // A subagent's turn: count it toward the prompt that started it.
      await update($, pending, p => add(p, spent))
      $.ui.status(statusText(await read($, last), total))

      return next(e)
    }

    const sub = await read($, pending)
    const prompt = add(spent, sub)
    await update($, pending, () => EMPTY)
    await update($, last, () => ({ ...prompt, turns: 1 }))
    $.ui.status(statusText(prompt, total))

    return next(e)
  })

  on('command.run', { command: 'token-cost' }, async $ => {
    const lastPrompt = await read($, last)
    const total = await read($, session)
    const engine = (await $.session.usage()).cost?.usd
    const text = [
      ...(lastPrompt === null ? ['Last prompt: no data yet'] : lines('Last prompt', lastPrompt)),
      ...lines(`Session (${total.turns} responses since the mod loaded)`, total),
      ...(engine === undefined ? [] : [`Claude Code's own total for the session: ${usd(engine)}`]),
      'Estimate at API list prices; on the Max plan this uses your limits, not dollars.',
    ].join('\n')

    return { text }
  })
}
