// GET ?zone=BE|NL → today's day-ahead and imbalance prices for the zone (default BE), plus tomorrow's
// day-ahead once published (around 13:00; tomorrow.da is [] before that). A source that fails comes back as null.
// ponytail: hits ENTSO-E + Elia on every request (NL imbalance comes from our own table); cache in a table if users ever approach
// ENTSO-E's 400 requests/min limit.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { brusselsDate, brusselsHour, dayAhead, dayBounds, imbalance, type Zone, ZONES } from '../_shared/prices.ts'

Deno.serve(async (req: Request) => {
  const zone = (new URL(req.url).searchParams.get('zone') ?? 'BE') as Zone
  if (!ZONES.includes(zone)) return Response.json({ error: 'bad zone' }, { status: 400 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = Deno.env.get('ENTSOE_TOKEN')!
  const day = brusselsDate(), next = brusselsDate(1)
  const [from, to] = dayBounds(day), [nextFrom, nextTo] = dayBounds(next)
  const [da, imb, daNext] = await Promise.allSettled([
    dayAhead(day, zone, token), imbalance(day, zone, db),
    brusselsHour() >= 12 ? dayAhead(next, zone, token) : Promise.resolve([]),
  ])
  for (const r of [da, imb, daNext]) if (r.status === 'rejected') console.error(r.reason)
  const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)
  return Response.json({
    zone, day, from, to, da: value(da), imb: value(imb),
    tomorrow: { day: next, from: nextFrom, to: nextTo, da: value(daNext) },
  })
})
