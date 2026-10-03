import { expect, mock, test } from 'claude-code/testing'

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

async function measure($: any, on: any) {
  mock.clock(on, { now: 0 })
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000, tokens: 50_000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 20, resetsAt: new Date(160 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 58 },
    ],
    cost: { usd: 4.32 },
    changed: ['context', 'rateLimits', 'cost'],
  })
}

test('terminal: draws rate limits and cost as text', async ($, on) => {
  await measure($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })

  expect(await ui.find({ text: /20%/ })).toBeDefined()
  expect(await ui.find({ text: /58%/ })).toBeDefined()
  expect(await ui.find({ text: /\$4\.32/ })).toBeDefined()
  expect(await ui.find({ text: /CTX/ })).toBeUndefined()
})

test('desktop: draws limits, tokens and cost', async ($, on) => {
  await measure($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props })
  const svgs = await ui.findAll({ type: 'Svg' })

  const alts = svgs.map(c => String(c.props.alt))

  expect(alts).toHaveLength(3)
  expect(alts[0]).toContain('5h window 20% used, resets in 2h 40m')
  expect(alts[1]).toContain('input tokens')
  expect(alts[2]).toBe('Session cost $4.32')
})

test('/usage-band hides the band', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine band</Text>
  })
  await measure($, on)
  await $.command.run({ command: 'usage-band' })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props })

  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
})

test('a window past its reset reads 0% until the next response', async ($, on) => {
  mock.clock(on, { now: 10 * 60_000 })
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(60_000).toISOString() }],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })

  expect(await ui.find({ text: /97%/ })).toBeUndefined()
  expect(await ui.find({ text: / 0%/ })).toBeDefined()
})

test('small readings keep their decimal', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 1.4 },
      { kind: 'seven_day', percentUsed: 46.6 },
    ],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })

  expect(await ui.find({ text: / 1\.4%/ })).toBeDefined()
  expect(await ui.find({ text: / 47%/ })).toBeDefined()
})
