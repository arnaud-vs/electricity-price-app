import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Storage from 'expo-sqlite/kv-store'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { Alert, AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

// Supabase edge functions base URL. Public, not a secret.
const API = 'https://qwzbbjeqjmscitzbnfgt.supabase.co/functions/v1'
const TZ = 'Europe/Brussels' // same clock in Amsterdam
const QH = 15 * 60e3
const H = 180

const ZONES = [['BE', 'Belgium'], ['NL', 'Netherlands']] as const
type Zone = (typeof ZONES)[number][0]
// NL imbalance in regulation state 2 has two prices: p is the shortage price, p2 the surplus price.
type Point = { t: string; p: number; p2?: number }
type Prices = { from: string; to: string; da: Point[] | null; imb: Point[] | null }
const FEEDBACK = 'arnaud@gridual.ai'
const DA = '#2563eb', IMB = '#ea580c', SURPLUS = '#16a34a'
const FIELDS = [
  ['da_above', 'Day-ahead above'], ['da_below', 'Day-ahead below'],
  ['imb_above', 'Imbalance above'], ['imb_below', 'Imbalance below'],
] as const
type Field = (typeof FIELDS)[number][0]
const EMPTY: Record<Field, string> = { da_above: '', da_below: '', imb_above: '', imb_below: '' }

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

const hhmm = (t: string | number) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

// ponytail: iOS only. Android 13+ also needs Notifications.setNotificationChannelAsync before asking.
async function pushToken(ask: boolean): Promise<string | null> {
  if (!Device.isDevice) return null
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted' && ask) ({ status } = await Notifications.requestPermissionsAsync())
  if (status !== 'granted') return null
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data
}

export default function App() {
  return <SafeAreaProvider><Home /></SafeAreaProvider>
}

function Home() {
  const [zone, setZone] = useState<Zone>(() => (Storage.getItemSync('zone') as Zone | null) ?? 'BE')
  const [prices, setPrices] = useState<Prices | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [fields, setFields] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [idea, setIdea] = useState('')
  const name = ZONES.find(z => z[0] === zone)![1]

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/prices?zone=${zone}`)
      if (!res.ok) throw new Error(String(res.status))
      setPrices(await res.json())
      setError(false)
    } catch {
      setError(true)
    }
  }, [zone])

  useEffect(() => {
    setPrices(null)
    load()
    const timer = setInterval(load, 5 * 60e3)
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load() })
    return () => { clearInterval(timer); sub.remove() }
  }, [load])

  // Show the zone's saved thresholds if notifications were allowed before.
  useEffect(() => {
    setFields(EMPTY)
    pushToken(false).then(async token => {
      if (!token) return
      const saved = await (await fetch(`${API}/alerts?zone=${zone}&token=${encodeURIComponent(token)}`)).json()
      if (saved) setFields(Object.fromEntries(FIELDS.map(([f]) => [f, saved[f] == null ? '' : String(saved[f])])) as Record<Field, string>)
    }).catch(() => {})
  }, [zone])

  function pick(z: Zone) {
    Storage.setItemSync('zone', z)
    setZone(z)
  }

  async function save() {
    const body: Record<string, number | null> = {}
    for (const [f, label] of FIELDS) {
      const v = fields[f].trim().replace(',', '.')
      if (v && !Number.isFinite(Number(v))) return Alert.alert(`${label}: not a number`)
      body[f] = v ? Number(v) : null
    }
    setSaving(true)
    try {
      const token = await pushToken(true)
      if (!token) return Alert.alert('Notifications are off', 'Allow notifications for this app in Settings to get price alerts.')
      const res = await fetch(`${API}/alerts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, zone, ...body }),
      })
      if (!res.ok) throw new Error(await res.text())
      Alert.alert(`Alerts for ${name} saved`)
    } catch {
      Alert.alert('Could not save alerts', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // ponytail: opens the Mail app instead of a backend mailer; add an edge function + email API if
  // people without Mail set up need to send ideas.
  async function sendIdea() {
    const url = `mailto:${FEEDBACK}?subject=${encodeURIComponent('Power Prices idea')}&body=${encodeURIComponent(idea)}`
    try {
      await Linking.openURL(url)
      setIdea('')
    } catch {
      Alert.alert('No mail app', `Send your idea to ${FEEDBACK}`)
    }
  }

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Text style={s.title}>Power prices</Text>
        <View style={s.zones}>
          {ZONES.map(([z, label]) => (
            <Pressable key={z} onPress={() => pick(z)} style={[s.zone, z === zone && s.zoneOn]}
              accessibilityRole="button" accessibilityState={{ selected: z === zone }}>
              <Text style={[s.zoneText, z === zone && s.zoneTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {error && <Text style={s.error}>Could not load prices. Pull down to retry.</Text>}
        {prices && <PriceCard prices={prices} />}

        <Text style={[s.h2, { marginTop: 24 }]}>Alerts for {name}</Text>
        <Text style={s.muted}>
          Leave a field empty for no alert. Day-ahead alerts arrive when tomorrow's prices are published (around 13:00).
          Imbalance alerts arrive when a quarter-hour crosses the threshold.
        </Text>
        {FIELDS.map(([f, label]) => (
          <View key={f} style={s.row}>
            <Text style={s.label}>{label}</Text>
            <View style={s.inputRow}>
              {/* The decimal pad has no minus key, so negative thresholds get a sign toggle. */}
              <Pressable style={s.sign} accessibilityRole="button" accessibilityLabel={`${label}: toggle negative`}
                onPress={() => setFields({ ...fields, [f]: fields[f].startsWith('-') ? fields[f].slice(1) : '-' + fields[f] })}>
                <Text style={s.signText}>±</Text>
              </Pressable>
              <TextInput style={s.input} value={fields[f]} onChangeText={v => setFields({ ...fields, [f]: v })}
                keyboardType="decimal-pad" placeholder="€/MWh" accessibilityLabel={`${label}, euro per megawatt hour`} />
            </View>
          </View>
        ))}
        <Pressable style={[s.button, saving && { opacity: 0.5 }]} onPress={save} disabled={saving} accessibilityRole="button">
          <Text style={s.buttonText}>Save alerts</Text>
        </Pressable>

        <Text style={[s.h2, { marginTop: 32 }]}>Ideas box</Text>
        <Text style={s.muted}>Missing a country, a price or a feature? Tell me.</Text>
        <TextInput style={[s.input, s.idea]} value={idea} onChangeText={setIdea} multiline placeholder="Your idea"
          accessibilityLabel="Your idea" />
        <Pressable style={[s.button, !idea.trim() && { opacity: 0.5 }]} onPress={sendIdea} disabled={!idea.trim()} accessibilityRole="button">
          <Text style={s.buttonText}>Send idea</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

// Day-ahead headlines the current quarter-hour, imbalance the latest published one.
function PriceCard({ prices: { da, imb, from, to } }: { prices: Prices }) {
  const now = Date.now()
  const daNow = da?.find(x => +new Date(x.t) <= now && now < +new Date(x.t) + QH)
  const imbNow = imb?.at(-1)
  const dual = imb?.filter(x => x.p2 != null).length ?? 0
  const series = [
    da?.length ? { color: DA, label: 'Day-ahead', points: da } : null,
    // Surplus first so the shortage trace covers it wherever the two prices are equal.
    dual ? { color: SURPLUS, label: 'Imbalance surplus', points: imb!.map(x => ({ t: x.t, p: x.p2 ?? x.p })) } : null,
    imb?.length ? { color: IMB, label: dual ? 'Imbalance shortage' : 'Imbalance', points: imb } : null,
  ].filter(x => x != null)
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Headline label="Day-ahead" color={DA} value={daNow?.p} note="now" missing={da == null ? 'unavailable' : 'not published'} />
        <Headline label="Imbalance" color={IMB} value={imbNow?.p} note={imbNow && `at ${hhmm(imbNow.t)}`}
          missing={imb == null ? 'unavailable' : 'none yet'} />
      </View>
      {imbNow?.p2 != null && (
        <Text style={s.flag}>Regulation state 2 (dual pricing): shortage €{Math.round(imbNow.p)}, surplus €{Math.round(imbNow.p2)}</Text>
      )}
      {series.length > 0 && <Chart series={series} from={from} to={to} />}
      <Text style={s.muted}>€/MWh per quarter-hour, today</Text>
      {dual > 0 && imbNow?.p2 == null && <Text style={s.muted}>Dual pricing in {dual} quarter-hour{dual > 1 ? 's' : ''} today</Text>}
    </View>
  )
}

function Headline({ label, color, value, note, missing }: { label: string; color: string; value?: number; note?: string; missing: string }) {
  return (
    <View>
      <Text style={s.muted}>{label}</Text>
      {value != null
        ? <Text style={[s.big, { color }]}>€{Math.round(value)} <Text style={s.muted}>{note}</Text></Text>
        : <Text style={s.muted}>{missing}</Text>}
    </View>
  )
}

type Series = { color: string; label: string; points: Point[] }

// Step lines from plain Views: one horizontal segment per quarter-hour, one riser between neighbours.
function Chart({ series, from, to }: { series: Series[]; from: string; to: string }) {
  const start = +new Date(from)
  const n = Math.round((+new Date(to) - start) / QH) // 92, 96 or 100 quarter-hours
  const all = series.flatMap(x => x.points.map(pt => pt.p))
  const max = Math.max(0, ...all), min = Math.min(0, ...all)
  const y = (p: number) => ((max - p) / (max - min || 1)) * H // px from the top
  const pct = (i: number) => `${(i / n) * 100}%` as const
  const ticks = Array.from({ length: n }, (_, i) => i).filter(i => ['00:00', '06:00', '12:00', '18:00'].includes(hhmm(start + i * QH)))
  return (
    <View>
      <View style={{ height: H, marginTop: 8 }}>
        <View style={[s.zero, { top: y(0) }]} />
        {series.map(({ color, points }) => {
          const byslot = new Map(points.map(x => [Math.round((+new Date(x.t) - start) / QH), x.p]))
          return [...byslot].map(([i, p]) => {
            const next = byslot.get(i + 1)
            return [
              <View key={`${color}h${i}`} style={[s.seg, { backgroundColor: color, left: pct(i), width: pct(1), top: y(p) - 1 }]} />,
              next != null && <View key={`${color}v${i}`} style={[s.seg, {
                backgroundColor: color, left: pct(i + 1), width: 2, marginLeft: -1, top: Math.min(y(p), y(next)) - 1,
                height: Math.abs(y(p) - y(next)) + 2,
              }]} />,
            ]
          })
        })}
      </View>
      <View style={{ height: 16 }}>
        {ticks.map(i => <Text key={i} style={[s.tick, { left: pct(i) }]}>{hhmm(start + i * QH)}</Text>)}
      </View>
      <View style={s.legend}>
        {series.map(x => (
          <View key={x.label} style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: x.color }]} />
            <Text style={s.legendText}>{x.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f4' },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', color: '#111' },
  zones: { flexDirection: 'row', gap: 8, marginTop: 12 },
  zone: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#e7e5e4' },
  zoneOn: { backgroundColor: '#111' },
  zoneText: { fontSize: 15, color: '#111', fontWeight: '500' },
  zoneTextOn: { color: '#fff' },
  h2: { fontSize: 18, fontWeight: '600', color: '#111' },
  big: { fontSize: 22, fontWeight: '700' },
  muted: { fontSize: 13, color: '#666', marginTop: 4 },
  error: { fontSize: 14, color: '#b91c1c', marginTop: 8 },
  flag: { fontSize: 13, color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 6, padding: 8, marginTop: 12, overflow: 'hidden' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  zero: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: '#999' },
  seg: { position: 'absolute', height: 2 },
  tick: { position: 'absolute', fontSize: 11, color: '#666', top: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: '#444' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  label: { fontSize: 16, color: '#111' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sign: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#e7e5e4', alignItems: 'center', justifyContent: 'center' },
  signText: { fontSize: 18, color: '#111' },
  input: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, width: 120, fontSize: 16, textAlign: 'right' },
  idea: { width: '100%', minHeight: 96, marginTop: 12, textAlign: 'left', textAlignVertical: 'top' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
