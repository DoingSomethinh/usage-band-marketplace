import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage } from 'claude-code'

import type { TokenTotals, UsageSnapshot, UsageWindow } from '../types'

const ZERO: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, ZERO)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

const HOUR = 3_600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 168 * HOUR }
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

function toSnapshot(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): UsageSnapshot {
  return {
    windows: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    costUsd: u.cost?.usd,
    contextPercent: u.context.percent,
  }
}

// ---------- formatting ----------

function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

// The reading has one decimal; below 10% that decimal is most of the story (1.4% is not 1%).
function fmtPct(pct: number): string {
  return pct < 10 ? `${Number(pct.toFixed(1))}%` : `${Math.round(pct)}%`
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

type Window = {
  label: string
  pct: number
  remaining?: string
  pace?: number // fraction of the window already elapsed, 0..1
  level: 'ok' | 'warm' | 'hot'
}

function describe(w: UsageWindow, now: number): Window {
  const resetAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const left = Number.isFinite(resetAt) ? resetAt - now : undefined
  const span = WINDOW_MS[w.kind]
  const pace =
    left !== undefined && left > 0 && span ? Math.min(1, Math.max(0, 1 - left / span)) : undefined
  // Past its reset the window starts over; the last reading is stale until the next response.
  const hasReset = left !== undefined && left <= 0
  const pct = hasReset ? 0 : w.percentUsed
  const isAhead = pace !== undefined && pct > pace * 100 + 15
  const level = pct >= 90 ? 'hot' : pct >= 75 || isAhead ? 'warm' : 'ok'
  return {
    label: LABEL[w.kind] ?? w.kind,
    pct,
    remaining: left !== undefined ? fmtCountdown(left) : undefined,
    pace,
    level,
  }
}

// ---------- desktop: an instrument strip drawn as SVG ----------
// Monochrome ink; amber or red appear only on a meter that needs attention.

type Level = Window['level']

const H = 20
const MID = H / 2
const FONT = 11
const CHAR = FONT * 0.602 // monospace advance
const LABEL_FONT = 9
const LABEL_TRACK = 0.7
const INK: Record<Level, string> = { ok: 'ink', warm: 'warm', hot: 'hot' }

const STYLE =
  `text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:${FONT}px;dominant-baseline:central}` +
  `.ink{fill:#1d1d1b}.mut{fill:#8c8a85}.lbl{fill:#9b9993;font-size:${LABEL_FONT}px;letter-spacing:${LABEL_TRACK}px}` +
  `.val{fill:#1d1d1b;font-weight:700}.trk{fill:#e4e2dd}.pace{fill:#bdbab3}` +
  `.div{fill:#e4e2dd}.warm{fill:#c98a2e}.hot{fill:#c8553d}` +
  `@media (prefers-color-scheme:dark){.ink,.val{fill:#ecebe8}.mut{fill:#8f8d88}.lbl{fill:#7d7b76}` +
  `.trk,.div{fill:#3a3936}.pace{fill:#6a6863}.warm{fill:#e0a64b}.hot{fill:#e2745c}}`

type Part = { w: number; draw: (x: number) => string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const gap = (w: number): Part => ({ w, draw: () => '' })

const text = (s: string, cls: string): Part => ({
  w: s.length * CHAR,
  draw: x => `<text x="${x}" y="${MID}" class="${cls}">${esc(s)}</text>`,
})

const label = (s: string): Part => ({
  w: s.length * LABEL_FONT * 0.602 + (s.length - 1) * LABEL_TRACK,
  draw: x => `<text x="${x}" y="${MID}" class="lbl">${esc(s.toUpperCase())}</text>`,
})

const slot = (p: Part, w: number, align: 'start' | 'end'): Part => ({
  w,
  draw: x => p.draw(align === 'end' ? x + w - p.w : x),
})

const divider: Part = {
  w: 1,
  draw: x => `<rect x="${x}" y="${MID - 6}" width="1" height="12" class="div"/>`,
}

const paceTick = (x: number) =>
  `<rect x="${x - 0.75}" y="${MID - 5}" width="1.5" height="10" rx=".75" class="pace"/>`

const clamp = (pct: number) => Math.min(100, Math.max(0, pct)) / 100

// A solid rounded bar: the 5h window.
function bar(pct: number, level: Level, pace?: number): Part {
  const W = 34
  return {
    w: W,
    draw: x =>
      `<rect x="${x}" y="${MID - 2.5}" width="${W}" height="5" rx="2.5" class="trk"/>` +
      `<rect x="${x}" y="${MID - 2.5}" width="${pct > 0 ? Math.max(5, W * clamp(pct)) : 0}" height="5" rx="2.5" class="${INK[level]}"/>` +
      (pace !== undefined ? paceTick(x + W * pace) : ''),
  }
}

// One dot per day: the 7d window.
function dots(pct: number, level: Level, pace?: number): Part {
  const N = 7
  const STEP = 6
  const W = STEP * N - 2
  const filled = Math.round(clamp(pct) * N)
  return {
    w: W,
    draw: x =>
      Array.from({ length: N }, (_, i) =>
        `<circle cx="${x + 2 + i * STEP}" cy="${MID}" r="2" class="${i < filled ? INK[level] : 'trk'}"/>`,
      ).join('') + (pace !== undefined ? paceTick(x + W * pace) : ''),
  }
}

// Input against output: how much of the traffic went in.
function ratio(input: number, output: number): Part {
  const W = 24
  const share = input + output > 0 ? input / (input + output) : 0
  return {
    w: W,
    draw: x =>
      `<rect x="${x}" y="${MID - 1.25}" width="${W}" height="2.5" rx="1.25" class="trk"/>` +
      `<rect x="${x}" y="${MID - 1.25}" width="${W * share}" height="2.5" rx="1.25" class="ink"/>`,
  }
}

function strip(parts: Part[]): string {
  const width = Math.ceil(parts.reduce((sum, p) => sum + p.w, 0))
  let x = 0
  const body = parts.map(p => {
    const out = p.draw(x)
    x += p.w
    return out
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">` +
    `<style>${STYLE}</style>${body.join('')}</svg>`
  )
}

function windowCell(w: Window, i: number): Part[] {
  const meter = i === 0 ? bar(w.pct, w.level, w.pace) : dots(w.pct, w.level, w.pace)
  return [
    label(w.label),
    gap(6),
    meter,
    gap(6),
    text(fmtPct(w.pct), 'val'),
  ]
}

// ---------- the band ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage))
    await $.command.register({
      name: 'usage-band',
      description: 'Show or hide the usage band above the prompt',
    })
    // Redraw so the reset countdowns and pace markers stay current.
    $.clock.every(30_000, () => void update($, tick, n => n + 1))

    return next(e)
  })

  on('command.run', { command: 'usage-band' }, async $ => {
    const hidden = await update($, isHidden, v => !v)

    return { text: hidden ? 'Usage band hidden.' : 'Usage band shown.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
      }))
    }
    // Cost and limits move with every request, not only when the turn ends.
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage))

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, tokens, () => ZERO)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    await read($, tick)
    const snap = await read($, snapshot)
    const t = await read($, tokens)
    const now = await $.clock.now()
    const windows = (snap?.windows ?? []).map(w => describe(w, now))
    const sent = t.input + t.cacheWrite
    const cost = snap?.costUsd !== undefined ? `$${snap.costUsd.toFixed(2)}` : undefined
    const limitsAlt = windows
      .map(w => `${w.label} window ${w.pct}% used${w.remaining ? `, resets in ${w.remaining}` : ''}`)
      .join('; ')
    const ioAlt = `${fmtTokens(sent)} input tokens, ${fmtTokens(t.output)} output tokens`

    // Limits left, tokens centred, cost right: the two sides share the room equally.
    if (e.surface === 'desktop') {
      const { Box, Svg } = $.ui.resolve({ ...e, surface: 'desktop' as const })
      const limits: Part[] = []
      windows.forEach((w, i) => {
        if (i > 0) limits.push(gap(9), divider, gap(9))
        limits.push(...windowCell(w, i))
      })
      const up = text(`↑${fmtTokens(sent)}`, 'val')
      const down = text(`↓${fmtTokens(t.output)}`, 'val')
      const side = Math.max(up.w, down.w)
      const io = [slot(up, side, 'end'), gap(6), ratio(sent, t.output), gap(6), slot(down, side, 'start')]

      return (
        <Box flexDirection="row" flexWrap="nowrap" alignItems="center" width="100%">
          <Box key="limits" flexGrow={1} width={0} flexDirection="row" justifyContent="flex-start">
            {limits.length > 0 && <Svg key="svg" source={strip(limits)} alt={limitsAlt} />}
          </Box>
          <Box key="io" flexShrink={0}>
            <Svg key="svg" source={strip(io)} alt={ioAlt} />
          </Box>
          <Box key="cost" flexGrow={1} width={0} flexDirection="row" justifyContent="flex-end">
            {cost && <Svg key="svg" source={strip([text(cost, 'val')])} alt={`Session cost ${cost}`} />}
          </Box>
        </Box>
      )
    }

    // Terminal: the same strip as one line, coloured only where it needs attention.
    const { Box, Text } = $.ui.resolve(e)
    const color = { ok: undefined, warm: 'yellow', hot: 'red' }
    const meter = (pct: number, n: number) => {
      const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * n)
      return '▰'.repeat(filled) + '▱'.repeat(n - filled)
    }

    return (
      <Box flexDirection="row" flexWrap="nowrap" width="100%">
        <Box key="limits" flexGrow={1} width={0} flexDirection="row" columnGap={2}>
          {windows.map((w, i) => (
            <Text key={`w${i}`}>
              <Text dimColor>{w.label.toUpperCase()} </Text>
              <Text color={color[w.level]}>{meter(w.pct, i === 0 ? 6 : 7)}</Text>
              <Text bold> {fmtPct(w.pct)}</Text>
            </Text>
          ))}
        </Box>
        <Text key="io">
          <Text bold>↑{fmtTokens(sent)}</Text>
          <Text bold> ↓{fmtTokens(t.output)}</Text>
        </Text>
        <Box key="cost" flexGrow={1} width={0} flexDirection="row" justifyContent="flex-end">
          {cost && <Text bold>{cost}</Text>}
        </Box>
      </Box>
    )
  })
}
