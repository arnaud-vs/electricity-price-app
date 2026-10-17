import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

// Supabase edge functions base URL. Public, not a secret.
const API = 'https://qwzbbjeqjmscitzbnfgt.supabase.co/functions/v1'
const TZ = 'Europe/Brussels'
const QH = 15 * 60e3
const H = 140

type Point = { t: string; p: number }
type Prices = { from: string; to: string; da: Point[] | null; imb: Point[] | null }
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
  const [prices, setPrices] = useState<Prices | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [fields, setFields] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/prices`)
      if (!res.ok) throw new Error(String(res.status))
      setPrices(await res.json())
      setError(false)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 5 * 60e3)
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load() })
    // Show the saved thresholds if notifications were allowed before.
    pushToken(false).then(async token => {
      if (!token) return
      const saved = await (await fetch(`${API}/alerts?token=${encodeURIComponent(token)}`)).json()
      if (saved) setFields(Object.fromEntries(FIELDS.map(([f]) => [f, saved[f] == null ? '' : String(saved[f])])) as Record<Field, string>)
    }).catch(() => {})
    return () => { clearInterval(timer); sub.remove() }
  }, [load])

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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }),
      })
      if (!res.ok) throw new Error(await res.text())
      Alert.alert('Alerts saved')
    } catch {
      Alert.alert('Could not save alerts', 'Check your connection and try again.')
    } finally {
      setSaving(false)
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Text style={s.title}>Belgian power prices</Text>
        <Text style={s.muted}>Today · €/MWh per quarter-hour</Text>
        {error && <Text style={s.error}>Could not load prices. Pull down to retry.</Text>}
        {prices && <>
          <Section title="Day-ahead" color="#2563eb" data={prices.da} from={prices.from} to={prices.to} />
          <Section title="Imbalance" color="#ea580c" data={prices.imb} from={prices.from} to={prices.to} latest />
        </>}

        <Text style={[s.h2, { marginTop: 24 }]}>Alerts</Text>
        <Text style={s.muted}>
          Leave a field empty for no alert. Day-ahead alerts arrive when tomorrow's prices are published (around 13:00).
          Imbalance alerts arrive when a quarter-hour crosses the threshold.
        </Text>
        {FIELDS.map(([f, label]) => (
          <View key={f} style={s.row}>
            <Text style={s.label}>{label}</Text>
            <TextInput style={s.input} value={fields[f]} onChangeText={v => setFields({ ...fields, [f]: v })}
              keyboardType="numbers-and-punctuation" returnKeyType="done" placeholder="€/MWh" accessibilityLabel={`${label}, euro per megawatt hour`} />
          </View>
        ))}
        <Pressable style={[s.button, saving && { opacity: 0.5 }]} onPress={save} disabled={saving} accessibilityRole="button">
          <Text style={s.buttonText}>Save alerts</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

// Day-ahead headlines the current quarter-hour, imbalance the latest published one.
function Section({ title, color, data, from, to, latest }:
  { title: string; color: string; data: Point[] | null; from: string; to: string; latest?: boolean }) {
  const now = Date.now()
  const point = latest ? data?.at(-1) : data?.find(x => +new Date(x.t) <= now && now < +new Date(x.t) + QH)
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.h2}>{title}</Text>
        {point && <Text style={[s.big, { color }]}>€{Math.round(point.p)} <Text style={s.muted}>{latest ? `at ${hhmm(point.t)}` : 'now'}</Text></Text>}
      </View>
      {data == null ? <Text style={s.error}>Source unavailable right now</Text>
        : data.length === 0 ? <Text style={s.muted}>Not published yet</Text>
        : <Chart data={data} color={color} from={from} to={to} highlight={point?.t} />}
    </View>
  )
}

function Chart({ data, color, from, to, highlight }: { data: Point[]; color: string; from: string; to: string; highlight?: string }) {
  const start = +new Date(from)
  const n = Math.round((+new Date(to) - start) / QH) // 92, 96 or 100 quarter-hours
  const slot = (t: string | number) => Math.round((+new Date(t) - start) / QH)
  const byslot = new Map(data.map(x => [slot(x.t), x.p]))
  const ps = data.map(x => x.p)
  const max = Math.max(0, ...ps), min = Math.min(0, ...ps)
  const scale = H / (max - min || 1), zero = -min * scale
  const hi = highlight ? slot(highlight) : -1
  const ticks = Array.from({ length: n }, (_, i) => i).filter(i => ['00:00', '06:00', '12:00', '18:00'].includes(hhmm(start + i * QH)))
  return (
    <View>
      <View style={{ height: H, flexDirection: 'row' }}>
        {Array.from({ length: n }, (_, i) => {
          const p = byslot.get(i)
          return (
            <View key={i} style={{ flex: 1 }}>
              {p != null && <View style={{
                position: 'absolute', left: 0, right: 0.5, bottom: p >= 0 ? zero : zero + p * scale,
                height: Math.max(1, Math.abs(p) * scale), backgroundColor: i === hi ? '#111' : color,
              }} />}
            </View>
          )
        })}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: zero, height: StyleSheet.hairlineWidth, backgroundColor: '#999' }} />
      </View>
      <View style={{ height: 16 }}>
        {ticks.map(i => <Text key={i} style={[s.tick, { left: `${(i / n) * 100}%` }]}>{hhmm(start + i * QH)}</Text>)}
      </View>
      <Text style={s.muted}>Low €{Math.round(Math.min(...ps))} · High €{Math.round(Math.max(...ps))}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f4' },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', color: '#111' },
  h2: { fontSize: 18, fontWeight: '600', color: '#111' },
  big: { fontSize: 22, fontWeight: '700' },
  muted: { fontSize: 13, color: '#666', marginTop: 4 },
  error: { fontSize: 14, color: '#b91c1c', marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  tick: { position: 'absolute', fontSize: 11, color: '#666', top: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  label: { fontSize: 16, color: '#111' },
  input: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, width: 120, fontSize: 16, textAlign: 'right' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
