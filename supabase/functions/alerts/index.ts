// A device's alert thresholds per zone, keyed by its Expo push token (no accounts).
//   GET  ?token=...&zone=BE|NL          → the device's thresholds for the zone, or null
//   POST { token, zone, da_above, da_below, imb_above, imb_below } → save; all null removes them

import { createClient } from 'npm:@supabase/supabase-js@2'
import { type Zone, ZONES } from '../_shared/prices.ts'

const FIELDS = ['da_above', 'da_below', 'imb_above', 'imb_below'] as const
const isToken = (t: unknown): t is string => typeof t === 'string' && /^ExponentPushToken\[[\w-]+\]$/.test(t)

Deno.serve(async (req: Request) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    if (req.method === 'GET') {
      const q = new URL(req.url).searchParams
      const token = q.get('token'), zone = (q.get('zone') ?? 'BE') as Zone
      if (!isToken(token) || !ZONES.includes(zone)) return Response.json({ error: 'bad token or zone' }, { status: 400 })
      const { data, error } = await db.from('alerts').select(FIELDS.join(',')).eq('token', token).eq('zone', zone).maybeSingle()
      if (error) throw error
      return Response.json(data)
    }

    const body = await req.json()
    const zone: Zone = body.zone ?? 'BE'
    if (!isToken(body.token) || !ZONES.includes(zone)) return Response.json({ error: 'bad token or zone' }, { status: 400 })
    const row: Record<string, number | null> = {}
    for (const f of FIELDS) {
      if (body[f] != null && !Number.isFinite(body[f])) return Response.json({ error: `bad ${f}` }, { status: 400 })
      row[f] = body[f] ?? null
    }
    const { error } = FIELDS.every(f => row[f] == null)
      ? await db.from('alerts').delete().eq('token', body.token).eq('zone', zone)
      // Changing thresholds re-arms both alerts.
      : await db.from('alerts').upsert({ token: body.token, zone, ...row, imb_state: null, da_notified_for: null })
    if (error) throw error
    return Response.json({ saved: true })
  } catch (e) {
    console.error('alerts failed', e)
    return Response.json({ error: 'internal error' }, { status: 500 })
  }
})
