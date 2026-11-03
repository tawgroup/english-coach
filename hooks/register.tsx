import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Check, Fix, Tally } from '../types'

type Api = Parameters<Hook<'session.start'>>[0]

const PANE = 'english-coach'
const TITLE = 'English coach'
const MODEL = 'haiku'
const STORE_KEY = 'tally-v1'
const MAX_CHARS = 1500

// Change a tag when that value's fields change: it declines what an earlier version stored.
const checks = atom({ plugin: 'english-coach', key: 'checks' } as const, [] as Check[], { shape: 'checks-1' })
const empty: Tally = { checked: 0, clean: 0, kinds: {}, examples: {} }
const tally = atom({ plugin: 'english-coach', key: 'tally' } as const, empty, { shape: 'tally-1' })
const busy = atom({ plugin: 'english-coach', key: 'busy' } as const, false, { shape: 'busy-1' })
const open = atom({ plugin: 'english-coach', key: 'open' } as const, null as string | null, { shape: 'open-1' })

// The mistake kinds the coach counts. The model must pick one of these.
const KINDS = [
  'third-person -s',
  'articles (a/the)',
  'missing subject/object',
  'question word order',
  'verb form/tense',
  'preposition',
  'word choice',
  'singular/plural',
  'word order',
  'spelling',
  'other',
]

const SYSTEM = `You are an English coach for a Vietnamese software engineer who often dictates prompts with speech-to-text.
You get one message they wrote to an AI coding assistant. Judge only their English.

Reply with ONE JSON object and nothing else:
{"lang":"en"|"other","fixed":"<the whole message, corrected, natural>","fixes":[{"wrong":"<exact words>","right":"<corrected words>","why":"<one short sentence>","kind":"<one kind>"}]}

Rules:
- "lang":"other" when the message is mostly not English (e.g. Vietnamese). Then fixes is [].
- Fix grammar and clearly unnatural phrasing. Do not fix casual style, slang, lowercase, missing final punctuation, code, file paths, commands, or technical terms.
- Keep each "wrong"/"right" short: the smallest span that shows the mistake.
- "kind" must be exactly one of: ${KINDS.join(' | ')}.
- No mistakes: "fixes":[] and "fixed" equal to the message.`

// ---------- helpers ----------

const looksEnglish = (text: string) => {
  const words = text.match(/[A-Za-z]{2,}/g) ?? []
  const vi = text.match(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi) ?? []
  return words.length >= 3 && vi.length < 3
}

// Drop code blocks and inline code: the coach judges prose only.
const prose = (text: string) =>
  text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/\s+/g, ' ').trim()

const parse = (raw: string): { lang: string; fixed: string; fixes: Fix[] } | null => {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as { lang?: unknown; fixed?: unknown; fixes?: unknown }
    const fixes = Array.isArray(o.fixes) ? o.fixes : []
    return {
      lang: o.lang === 'en' ? 'en' : 'other',
      fixed: typeof o.fixed === 'string' ? o.fixed : '',
      fixes: fixes
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map(f => ({
          wrong: String(f.wrong ?? ''),
          right: String(f.right ?? ''),
          why: String(f.why ?? ''),
          kind: KINDS.includes(String(f.kind)) ? String(f.kind) : 'other',
        }))
        .filter(f => f.wrong !== '' && f.wrong !== f.right),
    }
  } catch {
    return null
  }
}

const statusOf = (list: Check[]) => {
  if (list.length === 0) return undefined
  const clean = list.filter(c => c.fixes.length === 0).length
  return `en ${clean}/${list.length} ✓`
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const isUp = async ($: Api) => (await $.ui.panes()).some(p => p.id === PANE)

async function loadTally($: Api): Promise<Tally> {
  const v = (await $.store.get(STORE_KEY)) as Partial<Tally> | undefined
  if (!v || typeof v !== 'object') return empty
  return { checked: v.checked ?? 0, clean: v.clean ?? 0, kinds: v.kinds ?? {}, examples: v.examples ?? {} }
}

async function coach($: Api, text: string) {
  await update($, busy, () => true)
  try {
    const r = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: text.slice(0, MAX_CHARS),
      maxTokens: 1500,
      effort: 'low',
      timeoutMs: 30_000,
    })
    if (!r.isAnswered) return
    const out = parse(r.text)
    if (!out || out.lang !== 'en') return

    const check: Check = { at: Date.now(), text, fixed: out.fixed || text, fixes: out.fixes }
    await update($, checks, list => [...list, check].slice(-30))

    // Values read back from the store are frozen: build a fresh tally.
    const prev = await loadTally($)
    const kinds = { ...prev.kinds }
    const examples = { ...prev.examples }
    for (const f of check.fixes) {
      kinds[f.kind] = (kinds[f.kind] ?? 0) + 1
      examples[f.kind] = [f, ...(examples[f.kind] ?? [])].slice(0, 5)
    }
    const t: Tally = {
      checked: prev.checked + 1,
      clean: prev.clean + (check.fixes.length === 0 ? 1 : 0),
      kinds,
      examples,
    }
    await $.store.set(STORE_KEY, t)
    await update($, tally, () => t)

    $.ui.status(statusOf(await read($, checks)))
    if (!(await isUp($))) await $.ui.open({ id: PANE, title: TITLE })
  } finally {
    await update($, busy, () => false)
  }
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'english-coach',
      description: 'Toggle the English coach pane: fixes for your English prompts and your most common mistakes',
    })
    const t = await loadTally($)
    await update($, tally, () => t)
    $.ui.status(statusOf(await read($, checks)))
    return next(e)
  })

  on('command.run', { command: 'english-coach' }, async $ => {
    if (await isUp($)) {
      await $.ui.close({ id: PANE })
      return { text: 'English coach closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'English coach opened.' }
  })

  // Every prompt the person sends. The check runs after the prompt has gone in, so the turn never waits.
  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    if ('drop' in ran || e.command || e.isMeta || e.origin.kind !== 'composer') return ran
    const text = prose(e.text)
    if (looksEnglish(text)) void coach($, text).catch(err => $.ui.toast(`english-coach: ${String(err)}`))
    return ran
  }).catch(($, e, next) => next(e)) // never block a prompt

  // ---------- pane ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [list, t, isBusy, opened] = await Promise.all([read($, checks), read($, tally), read($, busy), read($, open)])
    const toggle = (id: string) => () => void update($, open, d => (d === id ? null : id))

    const last = list[list.length - 1]
    const sessionClean = list.filter(c => c.fixes.length === 0).length
    const ranked = Object.entries(t.kinds).sort((a, b) => b[1] - a[1])
    const rate = t.checked > 0 ? Math.round((t.clean / t.checked) * 100) : 0

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color="magenta">English coach</Text>
          <Text dimColor>
            {' · '}
            {list.length > 0 ? `this session ${sessionClean}/${list.length} clean` : 'no English prompt yet'}
            {isBusy ? ' · checking…' : ''}
          </Text>
        </Text>

        {!last && (
          <Text dimColor>Write or dictate a prompt in English. The fix shows up here; your turn does not wait for it.</Text>
        )}

        {last && (
          <Box flexDirection="column" borderStyle="round" borderColor={last.fixes.length ? 'yellow' : 'green'} paddingX={1}>
            <Text bold>Last prompt · {clock(last.at)}</Text>
            {last.fixes.length === 0 ? (
              <Text color="green">✓ No mistakes. Nice.</Text>
            ) : (
              last.fixes.map(f => (
                <Box flexDirection="column">
                  <Text>
                    <Text color="red" strikethrough>{f.wrong}</Text>
                    <Text> → </Text>
                    <Text color="green">{f.right}</Text>
                  </Text>
                  <Text dimColor>  {f.why} ({f.kind})</Text>
                </Box>
              ))
            )}
            {last.fixes.length > 0 && (
              <Box flexDirection="column">
                <Text> </Text>
                <Text dimColor>Natural version:</Text>
                <Text>{last.fixed}</Text>
                <Button plain key="speak:last" onPress={() => void $.audio.speak(last.fixed).catch(() => undefined)}>
                  <Text color="cyan">🔊 Read it aloud</Text>
                </Button>
              </Box>
            )}
          </Box>
        )}

        <Text> </Text>
        <Text>
          <Text bold color="cyan">Your common mistakes</Text>
          <Text dimColor> · all sessions · {t.checked} checked · {rate}% clean</Text>
        </Text>
        {ranked.length === 0 ? (
          <Text dimColor>Nothing yet.</Text>
        ) : (
          ranked.slice(0, 8).map(([kind, n]) => (
            <Box flexDirection="column">
              <Button plain key={`kind:${kind}`} onPress={toggle(kind)}>
                <Text>
                  <Text color="yellow">{String(n).padStart(3)}×</Text> {kind}
                  <Text dimColor>{opened === kind ? ' ▾' : ' ▸'}</Text>
                </Text>
              </Button>
              {opened === kind &&
                (t.examples[kind] ?? []).map(f => (
                  <Text dimColor>
                    {'     '}
                    {f.wrong} → <Text color="green">{f.right}</Text>
                  </Text>
                ))}
            </Box>
          ))
        )}
        {ranked.length > 0 && <Text dimColor>Click a mistake to see your past examples.</Text>}

        {list.length > 1 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold color="cyan">Earlier this session</Text>
            {list
              .slice(0, -1)
              .slice(-5)
              .reverse()
              .map(c => (
                <Text>
                  <Text dimColor>{clock(c.at)} </Text>
                  {c.fixes.length === 0 ? (
                    <Text color="green">✓ clean</Text>
                  ) : (
                    <Text color="yellow">{c.fixes.length} fix{c.fixes.length > 1 ? 'es' : ''}</Text>
                  )}
                  <Text dimColor> · {c.fixes.map(f => f.kind).join(', ') || c.text.slice(0, 40)}</Text>
                </Text>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
