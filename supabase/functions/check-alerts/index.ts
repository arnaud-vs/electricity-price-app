// Runs every 5 minutes from pg_cron (see migrations). Per zone (BE, NL), sends push notifications for:
//  - imbalance: once when the latest quarter-hour crosses above/below a device's threshold
//    (again only after it has returned inside the band, or crossed to the other side)
//  - day-ahead: once, as soon as tomorrow's prices are published, if any quarter-hour is past a threshold
// Protected by the x-cron-secret header.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { brusselsDate, brusselsHour, dayAhead, hhmm, imbalance, type Zone, ZONES } from '../_shared/prices.ts'

type Row = {
  token: string; zone: Zone
  da_above: number | null; da_below: number | null
  imb_above: number | null; imb_below: number | null
  imb_state: 'above' | 'below' | null; da_notified_for: string | null
}
type Msg = { to: string; title: string; body: string; sound: 'default' }

const eur = (p: number) => `€${Math.round(p)}`
const NAMES: Record<Zone, string> = { BE: 'Belgium', NL: 'Netherlands' }

Deno.serve(async (req: Request) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('unauthorized', { status: 401 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.from('alerts').select('*')
  if (error) { console.error(error); return new Response('db error', { status: 500 }) }
  const rows = data as Row[]
  const msgs: Msg[] = []
  const updates: [Row, Partial<Row>][] = []
  const tomorrow = brusselsDate(1)

  for (const zone of ZONES) {
    const zrows = rows.filter(r => r.zone === zone)
    if (!zrows.length) continue
    const name = NAMES[zone]

    // Imbalance: latest published quarter-hour of today. In NL regulation state 2 there are two
    // prices; "above" checks the higher one and "below" the lower one.
    const latest = (await imbalance(brusselsDate(), zone).catch(e => (console.error(e), []))).at(-1)
    if (latest) {
      const high = Math.max(latest.p, latest.p2 ?? latest.p), low = Math.min(latest.p, latest.p2 ?? latest.p)
      const dual = latest.p2 != null ? ` (dual pricing: shortage ${eur(latest.p)}, surplus ${eur(latest.p2)})` : ''
      for (const r of zrows) {
        const state = r.imb_above != null && high > r.imb_above ? 'above'
          : r.imb_below != null && low < r.imb_below ? 'below' : null
        if (state === r.imb_state) continue
        if (state) msgs.push({
          to: r.token, sound: 'default',
          title: `${name} imbalance price ${state} ${eur(state === 'above' ? r.imb_above! : r.imb_below!)}`,
          body: `${eur(state === 'above' ? high : low)}/MWh for the ${hhmm(latest.t)} quarter-hour${dual}`,
        })
        updates.push([r, { imb_state: state }])
      }
    }

    // Day-ahead: tomorrow's prices, published around 13:00 CET.
    const pending = zrows.filter(r => r.da_notified_for !== tomorrow && (r.da_above != null || r.da_below != null))
    if (!pending.length || brusselsHour() < 12) continue
    const da = await dayAhead(tomorrow, zone, Deno.env.get('ENTSOE_TOKEN')!).catch(e => (console.error(e), []))
    if (da.length < 92) continue // full day not published yet (92/96/100 quarter-hours depending on DST)
    const max = da.reduce((a, b) => (b.p > a.p ? b : a)), min = da.reduce((a, b) => (b.p < a.p ? b : a))
    for (const r of pending) {
      const lines = []
      if (r.da_above != null && max.p > r.da_above)
        lines.push(`${da.filter(x => x.p > r.da_above!).length} quarter-hours above ${eur(r.da_above)}, peak ${eur(max.p)} at ${hhmm(max.t)}`)
      if (r.da_below != null && min.p < r.da_below)
        lines.push(`${da.filter(x => x.p < r.da_below!).length} quarter-hours below ${eur(r.da_below)}, low ${eur(min.p)} at ${hhmm(min.t)}`)
      if (lines.length) msgs.push({ to: r.token, sound: 'default', title: `${name}: tomorrow's day-ahead prices`, body: lines.join('\n') })
      updates.push([r, { da_notified_for: tomorrow }])
    }
  }

  // Expo push API takes up to 100 messages per request.
  const dead: string[] = []
  for (let i = 0; i < msgs.length; i += 100) {
    const batch = msgs.slice(i, i + 100)
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch),
    })
    const { data: tickets, errors } = await res.json()
    if (errors) console.error('push failed', errors)
    tickets?.forEach((t: { details?: { error?: string } }, j: number) => {
      if (t.details?.error === 'DeviceNotRegistered') dead.push(batch[j].to)
    })
  }

  // ponytail: one UPDATE per changed device; batch it if the user count gets large.
  for (const [r, patch] of updates) await db.from('alerts').update(patch).eq('token', r.token).eq('zone', r.zone)
  if (dead.length) await db.from('alerts').delete().in('token', dead) // app uninstalled

  return Response.json({ sent: msgs.length, removed: dead.length })
})
