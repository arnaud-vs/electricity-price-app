// GET ?zone=BE|NL → today's day-ahead and imbalance prices for the zone (default BE). A source that fails comes back as null.
// ponytail: hits ENTSO-E + Elia on every request (NL imbalance comes from our own table); cache in a table if users ever approach
// ENTSO-E's 400 requests/min limit.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { brusselsDate, dayAhead, dayBounds, imbalance, type Zone, ZONES } from '../_shared/prices.ts'

Deno.serve(async (req: Request) => {
  const zone = (new URL(req.url).searchParams.get('zone') ?? 'BE') as Zone
  if (!ZONES.includes(zone)) return Response.json({ error: 'bad zone' }, { status: 400 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const day = brusselsDate()
  const [from, to] = dayBounds(day)
  const [da, imb] = await Promise.allSettled([dayAhead(day, zone, Deno.env.get('ENTSOE_TOKEN')!), imbalance(day, zone, db)])
  for (const r of [da, imb]) if (r.status === 'rejected') console.error(r.reason)
  const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)
  return Response.json({ zone, day, from, to, da: value(da), imb: value(imb) })
})
