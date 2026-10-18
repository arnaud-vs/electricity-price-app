// Run: node supabase/functions/_shared/prices.test.ts
import assert from 'node:assert'
import { dayBounds, merge, parseA44, perIsp, toPoint } from './prices.ts'

// Normal, short (spring forward) and long (fall back) Brussels days.
assert.deepEqual(dayBounds('2026-10-12').map(d => d.toISOString()), ['2026-10-11T22:00:00.000Z', '2026-10-12T22:00:00.000Z'])
assert.deepEqual(dayBounds('2026-03-29').map(d => d.toISOString()), ['2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'])
assert.deepEqual(dayBounds('2026-10-25').map(d => d.toISOString()), ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'])

// A03 curve: position 2 omitted (repeats 1), points outside the day dropped.
const xml = `<Publication_MarketDocument><TimeSeries><Period>
  <timeInterval><start>2026-10-11T22:00Z</start><end>2026-10-11T23:00Z</end></timeInterval>
  <resolution>PT15M</resolution>
  <Point><position>1</position><price.amount>50.5</price.amount></Point>
  <Point><position>3</position><price.amount>-10</price.amount></Point>
  <Point><position>4</position><price.amount>70</price.amount></Point>
</Period></TimeSeries></Publication_MarketDocument>`
const [from, to] = dayBounds('2026-10-12')
assert.deepEqual(parseA44(xml, from, to).map(x => x.p), [50.5, 50.5, -10, 70])
assert.deepEqual(parseA44(xml, new Date('2026-10-11T22:30Z'), to).map(x => x.p), [-10, 70])
// TenneT balance delta: per quarter-hour the highest upward and lowest downward price.
const dp = (t: string, up: string | null, down: string | null, mid: string) =>
  ({ timeInterval_start: t, max_upw_regulation_price: up, min_downw_regulation_price: down, mid_price: mid })
const isps = perIsp({ Response: { TimeSeries: [{ Period: [{ points: [
  dp('2026-10-18T11:44:36Z', null, null, '218.89'),
  dp('2026-10-18T11:45:00Z', null, '240.72', '218.89'),
  dp('2026-10-18T11:48:36Z', null, '186.00', '220.48'),
  dp('2026-10-18T12:00:36Z', '216.00', '239.71', '239.54'),
  dp('2026-10-18T12:02:36Z', '228.00', null, '239.54'),
] }] }] } })
assert.deepEqual(isps, [
  { t: '2026-10-18T11:30:00.000Z', up: null, down: null, mid: 218.89 },
  { t: '2026-10-18T11:45:00.000Z', up: null, down: 186, mid: 220.48 },
  { t: '2026-10-18T12:00:00.000Z', up: 228, down: 239.71, mid: 239.54 },
])
// No regulation → mid price; one direction → that price twice; both → bounded by the mid price.
assert.deepEqual(isps.map(toPoint).map(x => [x.p, x.p2]), [[218.89, 218.89], [186, 186], [239.54, 239.54]])
// Real state-2 quarter-hours of 17 Oct 2026 (20:15 and 21:30) against TenneT's settlement prices.
const t = isps[0].t
assert.deepEqual(toPoint({ t, up: 140, down: 142, mid: 208.29 }), { t, p: 208.29, p2: 142 })
assert.deepEqual(toPoint({ t, up: 210, down: 169.6, mid: 143.18 }), { t, p: 210, p2: 143.18 })
// A later poll of the same quarter-hour widens it, never narrows it.
assert.deepEqual(merge(isps[2], { t: isps[2].t, up: 200, down: 150, mid: 240 }), { t: isps[2].t, up: 228, down: 150, mid: 240 })
console.log('ok')
