// A device's alert thresholds, keyed by its Expo push token (no accounts).
//   GET  ?token=...                     → the device's thresholds, or null
//   POST { token, da_above, da_below, imb_above, imb_below } → save; all null removes the device

import { createClient } from 'npm:@supabase/supabase-js@2'

const FIELDS = ['da_above', 'da_below', 'imb_above', 'imb_below'] as const
const isToken = (t: unknown): t is string => typeof t === 'string' && /^ExponentPushToken\[[\w-]+\]$/.test(t)

Deno.serve(async (req: Request) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token')
      if (!isToken(token)) return Response.json({ error: 'bad token' }, { status: 400 })
      const { data, error } = await db.from('alerts').select(FIELDS.join(',')).eq('token', token).maybeSingle()
      if (error) throw error
      return Response.json(data)
    }

    const body = await req.json()
    if (!isToken(body.token)) return Response.json({ error: 'bad token' }, { status: 400 })
    const row: Record<string, number | null> = {}
    for (const f of FIELDS) {
      if (body[f] != null && !Number.isFinite(body[f])) return Response.json({ error: `bad ${f}` }, { status: 400 })
      row[f] = body[f] ?? null
    }
    const { error } = FIELDS.every(f => row[f] == null)
      ? await db.from('alerts').delete().eq('token', body.token)
      // Changing thresholds re-arms both alerts.
      : await db.from('alerts').upsert({ token: body.token, ...row, imb_state: null, da_notified_for: null })
    if (error) throw error
    return Response.json({ saved: true })
  } catch (e) {
    console.error('alerts failed', e)
    return Response.json({ error: 'internal error' }, { status: 500 })
  }
})
