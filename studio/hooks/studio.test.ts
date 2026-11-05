import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ESSENTIALS, displayName, draftWith, groupOf, labelIn, nameOfKey, regroupOwn, sortGroups } from './commands'
import { redactDeep, redactText } from './redact'

describe('REC masking', () => {
  test('masks keys, tokens and env secrets', async () => {
    const s = redactText('ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop and ' + 'ghp' + '_abcdefghijklmnopqrstuvwxyz123456')
    expect(s.includes('sk-ant')).toBe(false)
    expect(s.includes('ghp_')).toBe(false)
    expect(s.includes('ANTHROPIC_API_KEY=')).toBe(true)
  })

  test('masks stripe keys, bearer tokens and url passwords', async () => {
    // fake key split so secret scanners don't flag the fixture
    const s = redactText('sk' +'_live_abcdefghijklmnopqrstuvwx Bearer abcdefghijklmnopqrstuvwxyz postgres://admin:hunter22@db:5432')
    expect(s.includes('sk_live')).toBe(false)
    expect(s.includes('abcdefghijklmnopqrstuvwxyz')).toBe(false)
    expect(s.includes('hunter22')).toBe(false)
    expect(s.includes('admin')).toBe(true)
  })

  test('masks email, home path, valid PESEL and card, keeps plain numbers', async () => {
    const s = redactText('mail jan@example.com in /Users/jan/project pesel 44051401458 card 4111 1111 1111 1111 id 12345678901')
    expect(s.includes('jan@example.com')).toBe(false)
    expect(s.includes('/Users/jan')).toBe(false)
    expect(s.includes('~/project')).toBe(true)
    expect(s.includes('44051401458')).toBe(false)
    expect(s.includes('4111')).toBe(false)
    expect(s.includes('12345678901')).toBe(true)
  })

  test('masks custom words case-insensitively', async () => {
    expect(redactText('Client ACME Corp signed', ['acme corp']).includes('ACME')).toBe(false)
  })

  test('deep masking keeps the shape of tool input', async () => {
    const out = redactDeep({ command: 'echo jan@example.com', timeout: 5, nested: [{ path: '/Users/jan/a.ts' }] })
    expect(out.timeout).toBe(5)
    expect(out.command.includes('@')).toBe(false)
    expect(out.nested[0]?.path).toBe('~/a.ts')
  })
})

const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
}

test('HUD draws and REC toggles on every surface', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'studio', surface, ...BAND })
    expect(await ui.find({ key: 'explain' })).toBeDefined()
    expect((await ui.find({ key: 'rec' }))?.props.label).toBe('○ REC')
    await ui.press({ key: 'rec' })
    expect((await ui.find({ key: 'rec' }))?.props.label).toBe('● REC')
    await ui.press({ key: 'rec' })
    expect((await ui.find({ key: 'rec' }))?.props.label).toBe('○ REC')
    await ui.unmount()
  }
})

test('HUD keeps its controls when the band is narrow and short', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'studio', surface, ...BAND, props: { ...BAND.props, bodyColumns: 48, maxRows: 4 } })
    expect(await ui.find({ key: 'rec' })).toBeDefined()
    expect(await ui.find({ key: 'explain' })).toBeDefined()
    await ui.unmount()
  }
})

test('HUD minimizes to one row and expands again', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'studio', surface, ...BAND })
    expect((await ui.find({ key: 'collapse' }))?.props.label).toBe('▾ Minimize')
    await ui.press({ key: 'collapse' })
    expect((await ui.find({ key: 'collapse' }))?.props.label).toBe('▸ Expand')
    expect(await ui.find({ key: 'rec' })).toBeDefined()
    expect(await ui.find({ key: 'explain' })).toBeDefined()
    expect(await ui.find({ text: 'LAST TURN   ' })).toBeUndefined()
    await ui.press({ key: 'collapse' })
    expect((await ui.find({ key: 'collapse' }))?.props.label).toBe('▾ Minimize')
    expect(await ui.find({ text: 'LAST TURN   ' })).toBeDefined()
    await ui.unmount()
  }
})

test('HUD has a Commands button on every surface', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'studio', surface, ...BAND })
    expect((await ui.find({ key: 'commands' }))?.props.label).toBe('⌘ Commands')
    await ui.unmount()
  }
})

// ── Commands pane ─────────────────────────────────────────────────────────

describe('Commands helpers', () => {
  test('groups commands by where they come from', async () => {
    expect(groupOf('clear', 'builtin')).toBe('')
    expect(groupOf('yolo', 'user')).toBe('Your own')
    expect(groupOf('superpowers:brainstorming', 'plugin', 'superpowers')).toBe('superpowers')
    expect(groupOf('anthropic-skills:pdf', 'plugin')).toBe('anthropic-skills')
    expect(groupOf('rec', 'plugin')).toBe('Plugins')
    expect(groupOf('mcp__notion__search', 'mcp')).toBe('MCP · notion')
    expect(sortGroups(['zeta', 'Your own', 'alpha', 'zeta'])).toEqual(['Your own', 'alpha', 'zeta'])
  })

  test('labels, row keys and the draft', async () => {
    expect(labelIn('superpowers', 'superpowers:brainstorming')).toBe('brainstorming')
    expect(labelIn('Your own', 'yolo')).toBe('yolo')
    expect(displayName('superpowers', 'superpowers:brainstorming')).toBe('superpowers:brainstorming')
    expect(displayName('anthropic-skills', 'anthropic-skills:higgsfield-video-prompt-architect')).toBe('higgsfield-video-prompt-architect')
    expect(nameOfKey('run|y|superpowers:brainstorming')).toBe('superpowers:brainstorming')
    expect(nameOfKey('fav|e|compact')).toBe('compact')
    expect(nameOfKey('grp|superpowers')).toBe('')
    expect(nameOfKey('close')).toBe('')
    expect(draftWith('compact', '')).toEqual({ text: '/compact ', cursor: 9 })
    expect(draftWith('btw', '  is this safe? ')).toEqual({ text: '/btw is this safe?', cursor: 5 })
  })

  test('your own commands that share a prefix get a group', async () => {
    const own = (name: string) => ({ name, description: '', source: 'user' as const, group: 'Your own' })
    const out = regroupOwn(['firecrawl-search', 'firecrawl-scrape', 'firecrawl-map', 'hyperframes', 'hyperframes-cli', 'hyperframes-media', 'yolo', 'general-video', 'gsap'].map(own))
    const groupOfName = (n: string) => out.find(c => c.name === n)?.group
    expect(groupOfName('firecrawl-map')).toBe('firecrawl')
    expect(groupOfName('hyperframes')).toBe('hyperframes')
    expect(groupOfName('hyperframes-cli')).toBe('hyperframes')
    expect(groupOfName('yolo')).toBe('Your own')
    expect(groupOfName('general-video')).toBe('Your own')
    expect(groupOfName('gsap')).toBe('Your own')
  })

  test('the essentials stay a short, unique list', async () => {
    const cmds = ESSENTIALS.filter(x => x.cmd).map(x => x.cmd)
    expect(new Set(cmds).size).toBe(cmds.length)
    expect(ESSENTIALS.length <= 22).toBe(true)
    expect(ESSENTIALS.every(x => x.text.length <= 46)).toBe(true)
  })
})

const LIST = [
  { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
  { name: 'compact', description: 'Compact the conversation', source: 'builtin' },
  { name: 'model', description: 'Set the model', source: 'builtin' },
  { name: 'rec', description: 'Toggle REC mode', source: 'plugin', plugin: 'studio' },
  { name: 'superpowers:brainstorming', description: 'Brainstorm\n before building', source: 'plugin', plugin: 'superpowers' },
  { name: 'yolo', description: 'Run autonomously', source: 'user' },
] as const

const CMD_PANE = {
  plugin: 'studio',
  component: 'Pane',
  requestId: 'studio-commands',
  props: { title: 'Commands', isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const RUN = { command: 'commands', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

// Stands in for the engine beneath the plugin; `filled` collects what reached the prompt.
const engine = (on: On, filled: string[], draft = '', saved?: Map<string, unknown>, canFill = true) => {
  if (saved) {
    on('store.get', (_, e) => ({ value: saved.get(e.key) }))
    on('store.set', (_, e) => {
      saved.set(e.key, e.value)
      return { value: undefined }
    })
  } else mock.store(on)
  on('command.list', () => ({ value: LIST.map(c => ({ ...c })) }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_, e) => {
    if (canFill) filled.push(e.text)
    return { isFilled: canFill }
  })
  on('ui.copy', (_, e) => {
    filled.push(`copied:${e.text}`)
    return { value: { isCopied: true } }
  })
  on('ui.focus', () => ({}))
  on('ui.scroll', () => ({}))
}

test('Commands pane lists essentials and collapsed groups on every surface', async ($, on) => {
  engine(on, [])
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...CMD_PANE, surface })
    expect(await ui.find({ key: 'run|e|clear' })).toBeDefined()
    expect(await ui.find({ key: 'run|e|compact' })).toBeDefined()
    // listed by the docs, but not by this session: hidden
    expect(await ui.find({ key: 'run|e|effort' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Shift\+Tab/ })).toBeDefined()
    expect(await ui.find({ key: 'grp|Your own' })).toBeDefined()
    expect(await ui.find({ key: 'grp|studio' })).toBeDefined()
    expect(await ui.find({ key: 'run|y|superpowers:brainstorming' })).toBeUndefined()
    await ui.press({ key: 'grp|superpowers' })
    expect(await ui.find({ key: 'run|y|superpowers:brainstorming' })).toBeDefined()
    await ui.press({ key: 'grp|superpowers' })
    expect(await ui.find({ key: 'run|y|superpowers:brainstorming' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a press puts the command in the prompt, keeping the draft', async ($, on) => {
  const filled: string[] = []
  engine(on, filled, 'focus on the API part')
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...CMD_PANE, surface: 'terminal' })
  await ui.press({ key: 'run|e|compact' })
  expect(filled).toEqual(['/compact focus on the API part'])
  await ui.unmount()
})

test('a star pins a command to Favorites and is remembered', async ($, on) => {
  const saved = new Map<string, unknown>()
  engine(on, [], '', saved)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...CMD_PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'run|f|compact' })).toBeUndefined()
  await ui.press({ key: 'fav|e|compact' })
  expect(await ui.find({ key: 'run|f|compact' })).toBeDefined()
  expect((await ui.find({ key: 'fav|e|compact' }))?.props.label).toBe('★')
  expect(saved.get('studio.favorites')).toEqual(['compact'])
  await ui.press({ key: 'fav|f|compact' })
  expect(await ui.find({ key: 'run|f|compact' })).toBeUndefined()
  expect(saved.get('studio.favorites')).toEqual([])
  await ui.unmount()
})

test('Commands pane still draws in a narrow inline pane', async ($, on) => {
  engine(on, [])
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...CMD_PANE, surface: 'terminal', props: { ...CMD_PANE.props, bodyColumns: 38, placement: 'inline' } })
  expect(await ui.find({ key: 'run|e|compact' })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()
  await ui.unmount()
})

test('where the prompt cannot take it, the command is copied instead', async ($, on) => {
  const filled: string[] = []
  engine(on, filled, '', undefined, false)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...CMD_PANE, surface: 'desktop' })
  await ui.press({ key: 'run|e|compact' })
  expect(filled).toEqual(['copied:/compact '])
  await ui.unmount()
})

test('F stars the row the ring is on, not the Star button', async ($, on) => {
  const saved = new Map<string, unknown>()
  engine(on, [], '', saved)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...CMD_PANE, surface: 'terminal' })
  await $.ui.focus({ component: 'Pane', requestId: 'studio-commands', plugin: 'studio', element: 'run|e|compact', origin: { kind: 'person' } })
  expect((await ui.find({ key: 'star' }))?.props.label).toBe('★ Star')
  await $.ui.focus({ component: 'Pane', requestId: 'studio-commands', plugin: 'studio', element: 'star', origin: { kind: 'person' } })
  await ui.press({ key: 'star' })
  expect(saved.get('studio.favorites')).toEqual(['compact'])
  expect((await ui.find({ key: 'star' }))?.props.label).toBe('☆ Unstar')
  await ui.unmount()
})
