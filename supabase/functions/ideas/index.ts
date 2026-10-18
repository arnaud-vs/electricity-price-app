// POST { text } → stores an ideas-box submission and emails it to the developer via Resend.
// ponytail: no rate limit; add one (per IP, or a captcha) if spam shows up.

import { createClient } from 'npm:@supabase/supabase-js@2'

const TO = 'arnaud@gridual.ai'

Deno.serve(async (req: Request) => {
  const { text } = await req.json().catch(() => ({}))
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) return Response.json({ error: 'bad text' }, { status: 400 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await db.from('ideas').insert({ text: text.trim() })
  if (error) { console.error(error); return Response.json({ error: 'internal error' }, { status: 500 }) }

  // Stored either way; a failed email only gets logged.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Power Prices <onboarding@resend.dev>', to: TO, subject: 'Power Prices idea', text: text.trim() }),
  }).catch(e => e)
  if (!(res instanceof Response) || !res.ok) console.error('email failed', res instanceof Response ? await res.text() : res)
  return Response.json({ saved: true })
})
