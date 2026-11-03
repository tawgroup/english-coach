import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'english-coach',
  component: 'Pane',
  requestId: 'english-coach',
  props: {
    title: 'English coach',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

const REPLY = JSON.stringify({
  lang: 'en',
  fixed: 'He wants you to fix the bug.',
  fixes: [
    { wrong: 'He want', right: 'He wants', why: 'Third person singular takes -s.', kind: 'third-person -s' },
    { wrong: 'want you fix', right: 'want you to fix', why: '"want someone to do".', kind: 'verb form/tense' },
  ],
})

// Each hook here stands for the engine beneath the mod.
const toasts: string[] = []
const engine = (on: Parameters<TestBody>[1], opened: string[], asked: string[], reply = REPLY) => {
  const store: Record<string, unknown> = {}
  on('command.register', () => ({ value: { command: 'english-coach' } }))
  on('ui.panes', () => ({ value: opened.map(id => ({ id })) as never }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('store.get', (_, e) => ({ value: store[e.key] as never }))
  on('store.set', (_, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined as never }
  })
  on('model.complete', (_, e) => {
    asked.push(typeof e.prompt === 'string' ? e.prompt : '')
    return { value: { isAnswered: true, text: reply, usage: {} } as never }
  })
  on('ui.status', () => ({ value: undefined as never }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined as never }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
}

const submit = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const
const settle = () => new Promise(r => setTimeout(r, 100))
const texts = async (ui: { findAll: (q: { type: 'Text' }) => Promise<readonly { text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('an empty pane says to write in English', async ($, on) => {
  engine(on, [], [])
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await texts(ui)).toContain('no English prompt yet')
    await ui.unmount()
  }
})

test('an English prompt is coached, tallied, and opens the pane', async ($, on) => {
  const opened: string[] = []
  const asked: string[] = []
  engine(on, opened, asked)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(submit('He want you fix the bug in `src/a.ts` please'))
  await settle()

  expect(asked.length).toBe(1)
  expect(asked[0]).not.toContain('src/a.ts')
  expect(opened).toEqual(['english-coach'])
  expect(toasts).toEqual([])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('He wants')
    expect(all).toContain('He wants you to fix the bug.')
    expect(all).toContain('third-person -s')
    expect(all).toContain('this session 0/1 clean')
    await ui.press({ key: 'kind:third-person -s' })
    expect(await texts(ui)).toContain('He want → He wants')
    await ui.press({ key: 'kind:third-person -s' })
    await ui.unmount()
  }
})

test('Vietnamese prompts, slash commands and short prompts are skipped', async ($, on) => {
  const asked: string[] = []
  engine(on, [], asked)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(submit('ok làm luôn đi bro, tạo repo luôn nhé'))
  await $.prompt.submit(submit('ok go'))
  await $.prompt.submit({ ...submit('/english-coach'), command: { name: 'english-coach', args: '' } })
  await settle()
  expect(asked.length).toBe(0)
})

test('a clean prompt counts as clean', async ($, on) => {
  engine(on, [], [], JSON.stringify({ lang: 'en', fixed: 'Please fix the bug.', fixes: [] }))
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(submit('Please fix the bug.'))
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toContain('No mistakes')
  expect(all).toContain('this session 1/1 clean')
  await ui.unmount()
})
