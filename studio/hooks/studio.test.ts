import { describe, expect, mock, test } from 'claude-code/testing'

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
