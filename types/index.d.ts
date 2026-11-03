export type Fix = { wrong: string; right: string; why: string; kind: string }
export type Check = { at: number; text: string; fixed: string; fixes: Fix[] }
export type Tally = { checked: number; clean: number; kinds: Record<string, number>; examples: Record<string, Fix[]> }

declare module 'claude-code' {
  interface PluginState {
    'english-coach': {
      checks: Shaped<Check[]>
      tally: Shaped<Tally>
      busy: Shaped<boolean>
      open: Shaped<string | null>
    }
  }
}
