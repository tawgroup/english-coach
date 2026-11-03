# english-coach

A Claude Code mod for people who work in English as a second language. It sits in a pane beside the chat and coaches every English prompt you send, typed or dictated.

- **Fix right away.** After each English prompt the pane shows wrong → right, one short reason, and a natural version of the whole message. Your turn never waits: the check runs after the prompt has gone in.
- **Count your habits.** Mistakes are grouped by kind (third-person -s, articles, question word order, prepositions…) and counted across all sessions, so you can see what you keep getting wrong and whether it is going down. Click a kind to see your past examples.
- **Hear it.** 🔊 reads the corrected version aloud with the system voice (`say` on macOS).
- **Status line.** `en 7/10 ✓`: clean prompts out of English prompts this session.

Vietnamese (non-English) prompts, slash commands, very short prompts and code (fenced or inline) are skipped.

## How it calls the model

No API key. The mod uses `$.model.complete`, which runs through Claude Code's own client and the account you are logged in with. Each English prompt costs one small Haiku call (`effort: low`), counted against that account's usage.

## Install

Requires a Claude Code version with mod support.

```bash
claude plugin marketplace add tawgroup/english-coach
claude plugin install english-coach@english-coach
```

Start a new session (or run `/reload-plugins`), send a prompt in English, and the pane opens by itself. `/english-coach` toggles it.

Try it for one session only:

```bash
git clone https://github.com/tawgroup/english-coach.git
claude --plugin-dir ./english-coach
```

## Tweak

In `hooks/register.tsx`: `MODEL` (default `haiku`), `KINDS` (the mistake categories), and `SYSTEM` (the coaching rules, e.g. what not to correct).

## Layout

```
.claude-plugin/plugin.json      manifest
hooks/hooks.json                module list
hooks/register.tsx              the mod: prompt hook, model call, pane
types/index.d.ts                state type contract
tests/english-coach.test.tsx    tests (claude plugin test .)
```
