// Run: node supabase/functions/_shared/prices.test.ts
import assert from 'node:assert'
import { dayBounds, parseA44 } from './prices.ts'

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
console.log('ok')
