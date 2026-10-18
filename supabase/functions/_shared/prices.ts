// Day-ahead (ENTSO-E) and imbalance (Elia for BE, TenneT for NL) prices for one calendar day.
// Every price is { t: ISO UTC start of the quarter-hour, p: €/MWh }. NL imbalance also has p2:
// p is the shortage price, p2 the surplus price (equal except in regulation state 2).

export type Point = { t: string; p: number; p2?: number }
export type Zone = 'BE' | 'NL'
export const ZONES: Zone[] = ['BE', 'NL']
const EIC: Record<Zone, string> = { BE: '10YBE----------2', NL: '10YNL----------L' }

const QH = 15 * 60e3
const TZ = 'Europe/Brussels' // Amsterdam keeps the same clock, so one timezone covers both zones

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
// deno-lint-ignore no-explicit-any
type Db = any // SupabaseClient; kept loose so this file stays free of npm imports for the node test

export function imbalance(date: string, zone: Zone, db: Db): Promise<Point[]> {
  return zone === 'NL' ? nl(date, db) : elia(date)
}

async function nl(date: string, db: Db): Promise<Point[]> {
  const [from, to] = dayBounds(date)
  const { data, error } = await db.from('imbalance_nl').select('t, up, down, mid')
    .gte('t', from.toISOString()).lt('t', to.toISOString()).order('t')
  if (error) throw error
  return (data as IspRow[]).filter(r => r.up != null || r.down != null || r.mid != null)
    .map(r => toPoint({ ...r, t: new Date(r.t).toISOString() }))
}

async function elia(date: string): Promise<Point[]> {
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

// NL: TenneT settlement prices only arrive the next day (and allow 25 requests a day), so today's
// prices come from Balance Delta /latest: the last 30 minutes in 12-second steps. check-alerts
// collects it every 5 minutes into imbalance_nl, one row per quarter-hour.
export type IspRow = { t: string; up: number | null; down: number | null; mid: number | null }
type DeltaPoint = { timeInterval_start: string; max_upw_regulation_price: string | null; min_downw_regulation_price: string | null; mid_price: string | null }

export async function balanceDelta(key: string): Promise<IspRow[]> {
  const res = await fetch('https://api.tennet.eu/publications/v1/balance-delta-high-res/latest',
    { headers: { apikey: key, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`TenneT ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return perIsp(await res.json())
}

// Per quarter-hour: highest upward price, lowest downward price (null = no regulation that way), last mid price.
export function perIsp(json: { Response?: { TimeSeries: { Period: { points: DeltaPoint[] }[] }[] } }): IspRow[] {
  const rows = new Map<number, IspRow>()
  const num = (s: string | null) => (s == null ? null : +s)
  for (const x of (json.Response?.TimeSeries ?? []).flatMap(s => s.Period.flatMap(p => p.points))) {
    const t = Math.floor(Date.parse(x.timeInterval_start) / QH) * QH
    const r = rows.get(t) ?? { t: new Date(t).toISOString(), up: null, down: null, mid: null }
    rows.set(t, merge(r, { t: r.t, up: num(x.max_upw_regulation_price), down: num(x.min_downw_regulation_price), mid: num(x.mid_price) }))
  }
  return [...rows.values()]
}

const best = (a: number | null, b: number | null, pick: (...n: number[]) => number) => (a == null ? b : b == null ? a : pick(a, b))
export const merge = (a: IspRow, b: IspRow): IspRow =>
  ({ t: a.t, up: best(a.up, b.up, Math.max), down: best(a.down, b.down, Math.min), mid: b.mid ?? a.mid })

// Shortage and surplus price of a quarter-hour, as TenneT settles them (checked against settlement
// prices for 16 quarter-hours on 17 Oct 2026, all exact):
//  - upward only (state 1): highest upward price; downward only (state -1): lowest downward price
//  - both (state 2): shortage = max(highest upward, mid), surplus = min(lowest downward, mid)
//  - neither (state 0): mid price
export const toPoint = (r: IspRow): Point => {
  const { up, down, mid } = r
  if (up != null && down != null) return { t: r.t, p: Math.max(up, mid ?? up), p2: Math.min(down, mid ?? down) }
  const p = up ?? down ?? mid!
  return { t: r.t, p, p2: p }
}

export async function dayAhead(date: string, zone: Zone, token: string): Promise<Point[]> {
  const [from, to] = dayBounds(date)
  const eic = EIC[zone]
  const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const res = await fetch(`https://web-api.tp.entsoe.eu/api?securityToken=${token}&documentType=A44`
    + `&in_Domain=${eic}&out_Domain=${eic}&periodStart=${fmt(from)}&periodEnd=${fmt(to)}`)
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
