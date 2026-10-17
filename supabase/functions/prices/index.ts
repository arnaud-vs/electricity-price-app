// GET → today's Belgian day-ahead and imbalance prices. A source that fails comes back as null.
// ponytail: hits ENTSO-E + Elia on every request; cache in a table if users ever approach
// ENTSO-E's 400 requests/min limit.

import { brusselsDate, dayAhead, dayBounds, imbalance } from '../_shared/prices.ts'

Deno.serve(async () => {
  const day = brusselsDate()
  const [from, to] = dayBounds(day)
  const [da, imb] = await Promise.allSettled([dayAhead(day, Deno.env.get('ENTSOE_TOKEN')!), imbalance(day)])
  for (const r of [da, imb]) if (r.status === 'rejected') console.error(r.reason)
  const value = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)
  return Response.json({ day, from, to, da: value(da), imb: value(imb) })
})
