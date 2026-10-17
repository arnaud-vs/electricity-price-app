// Belgian day-ahead (ENTSO-E) and imbalance (Elia) prices for one Brussels calendar day.
// Every price is { t: ISO UTC start of the quarter-hour, p: €/MWh }.

export type Point = { t: string; p: number }

const TZ = 'Europe/Brussels'
const BE = '10YBE----------2'

// Brussels calendar date (YYYY-MM-DD), plusDays from today.
export function brusselsDate(plusDays = 0): string {
  const d = new Date(new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + plusDays)
  return d.toISOString().slice(0, 10)
}

export function brusselsHour(): number {
  return +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date())
}

export function hhmm(t: string): string {
  return new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

// Brussels midnight as a UTC instant. DST switches at 01:00 UTC, so the offset at
// UTC midnight of the same date is always the offset at local midnight.
function midnight(date: string): Date {
  const utc = new Date(date + 'T00:00:00Z')
  const m = new Intl.DateTimeFormat('en', { timeZone: TZ, timeZoneName: 'longOffset' })
    .format(utc).match(/GMT([+-])(\d\d):(\d\d)/)
  const mins = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0
  return new Date(utc.getTime() - mins * 60e3)
}

// [start, end) of a Brussels day in UTC. 23h, 24h or 25h long.
export function dayBounds(date: string): [Date, Date] {
  const next = new Date(date + 'T00:00:00Z')
  next.setUTCDate(next.getUTCDate() + 1)
  return [midnight(date), midnight(next.toISOString().slice(0, 10))]
}

// ponytail: ods162 is the live dataset under the current imbalance methodology. Elia switches
// methodology on 24/11/2026 (preview dataset ods212); check whether ods162 keeps updating then.
export async function imbalance(date: string): Promise<Point[]> {
  const [from, to] = dayBounds(date)
  const where = `datetime >= '${from.toISOString()}' and datetime < '${to.toISOString()}'`
  const res = await fetch('https://opendata.elia.be/api/explore/v2.1/catalog/datasets/ods162/records'
    + `?select=datetime,imbalanceprice&order_by=datetime&limit=100&where=${encodeURIComponent(where)}`)
  if (!res.ok) throw new Error(`Elia ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const { results } = await res.json()
  return results
    .filter((r: { imbalanceprice: number | null }) => r.imbalanceprice != null)
    .map((r: { datetime: string; imbalanceprice: number }) => ({ t: new Date(r.datetime).toISOString(), p: r.imbalanceprice }))
}

export async function dayAhead(date: string, token: string): Promise<Point[]> {
  const [from, to] = dayBounds(date)
  const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const res = await fetch(`https://web-api.tp.entsoe.eu/api?securityToken=${token}&documentType=A44`
    + `&in_Domain=${BE}&out_Domain=${BE}&periodStart=${fmt(from)}&periodEnd=${fmt(to)}`)
  const xml = await res.text()
  if (!xml.includes('<TimeSeries')) {
    if (/No matching data/i.test(xml)) return [] // not published yet
    throw new Error(`ENTSO-E ${res.status}: ${xml.slice(0, 300)}`)
  }
  return parseA44(xml, from, to)
}

const tag = (s: string, name: string) => s.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]

export function parseA44(xml: string, from: Date, to: Date): Point[] {
  const slots = new Map<number, number>()
  const periods = [...xml.matchAll(/<Period>([\s\S]*?)<\/Period>/g)].map(m => m[1])
    .sort((a, b) => Number(b.includes('PT15M')) - Number(a.includes('PT15M'))) // 15-min series win over hourly
  for (const per of periods) {
    const step = tag(per, 'resolution') === 'PT15M' ? 15 : 60
    const end = Date.parse(tag(per, 'end')!)
    const points = new Map([...per.matchAll(/<Point>([\s\S]*?)<\/Point>/g)]
      .map(m => [+tag(m[1], 'position')!, +tag(m[1], 'price.amount')!]))
    let price: number | undefined
    for (let pos = 1, t = Date.parse(tag(per, 'start')!); t < end; pos++, t += step * 60e3) {
      price = points.get(pos) ?? price // curve type A03 omits points that repeat the previous price
      if (price === undefined) continue
      for (let q = 0; q < step; q += 15) if (!slots.has(t + q * 60e3)) slots.set(t + q * 60e3, price)
    }
  }
  return [...slots]
    .filter(([t]) => t >= +from && t < +to)
    .sort((a, b) => a[0] - b[0])
    .map(([t, p]) => ({ t: new Date(t).toISOString(), p }))
}
