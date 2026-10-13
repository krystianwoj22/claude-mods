import { expect, test } from 'claude-code/testing'

const turn = (usage: { model: string; read: number; write: number; out: number }, agentId?: string) => ({
  answer: 'ok',
  durationMs: 1000,
  isAborted: false,
  turnId: `t-${Math.random()}`,
  reason: 'answer' as const,
  ...(agentId === undefined ? {} : { agentId }),
  usage: {
    model: usage.model,
    input_tokens: 0,
    output_tokens: usage.out,
    cache_read_input_tokens: usage.read,
    cache_creation_input_tokens: usage.write,
  },
})

test('shows the last prompt and the session total, subagents included', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  // 300k read at $0.20/M = $0.06, 2k written at $8/M = $0.016, 1.5k out at $20/M = $0.03
  await $.turn.complete(turn({ model: 'claude-opus-5-5', read: 300_000, write: 2_000, out: 1_500 }))
  expect(statuses.at(-1)).toBe('Last: 304k tok · ~$0.11 (cache 99%) | Session: ~$0.11')

  // A subagent turn rolls into the next main prompt.
  await $.turn.complete(turn({ model: 'claude-haiku-4-5', read: 0, write: 100_000, out: 0 }, 'sub-1'))
  await $.turn.complete(turn({ model: 'claude-opus-5-5', read: 300_000, write: 0, out: 0 }))
  // $0.20 (haiku write) + $0.06 (opus read) = $0.26 for the prompt; session $0.37
  expect(statuses.at(-1)).toBe('Last: 400k tok · ~$0.26 (cache 75%) | Session: ~$0.37')
})

test('a turn without usage changes nothing', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  const { usage: _, ...noUsage } = turn({ model: 'claude-opus-5-5', read: 1, write: 1, out: 1 })
  await $.turn.complete(noUsage)
  expect(statuses).toEqual([])
})
