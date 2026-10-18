// Run: node supabase/functions/_shared/prices.test.ts
import assert from 'node:assert'
import { dayBounds, parseA44, parseTennet } from './prices.ts'

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
// TenneT: second price only in regulation state 2, missing prices and other days dropped, sorted.
const pt = (t: string, shortage: string | null, surplus: string | null, regulation_state: number) =>
  ({ timeInterval_start: t, shortage, surplus, regulation_state })
const tennet = { Response: { TimeSeries: [{ Period: { Points: [
  pt('2026-10-12T10:15', '120.50', '-30.00', 2),
  pt('2026-10-12T10:00', '80.00', '80.00', 1),
  pt('2026-10-12T10:30', null, null, 0),
  pt('2026-10-13T00:00', '50.00', '50.00', -1), // next local day
  pt('2026-10-12T00:00', '60.00', '60.00', 0), // local midnight = 22:00 UTC the day before

] } }] } }
assert.deepEqual(parseTennet({ error: 'No data found' }, from, to), [])
assert.deepEqual(parseTennet(tennet, from, to), [
  { t: '2026-10-11T22:00:00.000Z', p: 60 },
  { t: '2026-10-12T08:00:00.000Z', p: 80 },
  { t: '2026-10-12T08:15:00.000Z', p: 120.5, p2: -30 },
])
console.log('ok')
