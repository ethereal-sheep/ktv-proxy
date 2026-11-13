import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { command, getHost, getQueue, scanNetwork, setHost, searchSingers, searchSongs, singerImg, type Filter, type Singer, type Song } from './api'
import { ACCENTS, useTheme, type Mode } from './theme'
import { Icon, SettingsCtx, useSettingsState, type IconName } from './settings'

const LANGS: [string, string][] = [['Mandarin', '国语'], ['Cantonese', '粤语'], ['Hokkien', '闽南语'], ['English', '英语'], ['Malay', '马来语'], ['Japanese', '日语'], ['Korean', '韩语'], ['Vietnamese', '越南语'], ['Tamil', '泰米尔语'], ['Thai', '泰国语'], ['Tagalog', '菲律宾语'], ['Hindi', '印地语'], ['German', '德语'], ['French', '法语'], ['Other', '其他']]
const TYPES = ['Duets', 'Romanised', 'CNY', 'Christmas', 'Clubbing', 'KTV Classics', 'NDP', 'Children', 'Oldies', 'Hari Raya', 'Opera']
const AREAS = ['All', 'China', 'Hong Kong', 'Taiwan', 'English', 'Japan', 'Korea', 'Vietnam', 'India', 'Thailand', 'Philippines', 'Malaysia', 'Germany', 'French', 'Other']
const FILTERS: [string, [string, Filter][]][] = [
  ['Ranking', [['Popular', { sortType: 'TopByHotSong' }], ['New', { sortType: 'TopByNewSong' }]]],
  ['Language', LANGS.map(([n, v]): [string, Filter] => [n, { lang: v }])],
  ['Category', TYPES.map((n, i): [string, Filter] => [n, { songType: String(i + 1) }])],
]
const fkey = (f: Filter) => JSON.stringify(f)
const filterName = (f: Filter) => FILTERS.flatMap(([, i]) => i).find(([, x]) => fkey(x) === fkey(f))?.[0]

const btn = 'rounded-xl bg-zinc-200 px-4 py-3 text-sm font-medium active:bg-accent active:text-white hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-90'

// Debounced, paged fetch; stale responses are dropped.
function usePaged<T>(fetcher: (page: number) => Promise<{ items: T[]; maxPage: number }>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([])
  const [page, setPage] = useState(0)
  const [maxPage, setMax] = useState(0)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const req = useRef(0)
  const tried = useRef(0)
  const load = (p: number) => {
    const id = ++req.current
    tried.current = p
    setState('loading')
    fetcher(p).then(r => {
      if (id !== req.current) return
      setItems(prev => (p ? [...prev, ...r.items] : r.items)); setPage(p); setMax(r.maxPage); setState('idle')
    }).catch(() => id === req.current && setState('error'))
  }
  useEffect(() => { const t = setTimeout(() => load(0), 250); return () => clearTimeout(t) }, deps) // eslint-disable-line
  return { items, state, hasMore: page + 1 < maxPage, more: () => load(page + 1), retry: () => load(tried.current) }
}

// Infinite scroll: fetch the next page when the sentinel is within 600px of the viewport.
function Status({ state, empty, hasMore, more, retry }: { state: string; empty: boolean; hasMore: boolean; more: () => void; retry: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hasMore || state !== 'idle' || !el.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && more(), { rootMargin: '600px' })
    io.observe(el.current)
    return () => io.disconnect()
  }, [hasMore, state, more])
  if (state === 'error') return <div className="p-6 text-center"><p className="mb-3 text-red-500">Can't reach the KTV machine.</p><button className={btn} onClick={retry}>Try again</button></div>
  if (state === 'loading') return <p className="p-6 text-center text-zinc-500">Loading…</p>
  if (empty) return <p className="p-6 text-center text-zinc-500">Nothing found.</p>
  return <div ref={el} className="h-8" />
}

type Act = (cmd: string, val?: string, label?: string, icon?: IconName) => void

// Scale font down continuously once text passes `from` width units (CJK glyphs count double), never below `min` px.
const fit = (t: string, base: number, from: number, min: number) => {
  const w = [...t].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  return { fontSize: Math.max(min, Math.min(base, (base * from) / w)) }
}

function SongRow({ s, act, queue }: { s: Song; act: Act; queue?: boolean }) {
  const { helperLabels } = useContext(SettingsCtx)
  const lbl = (t: string) => helperLabels && <span className="text-[10px] font-normal leading-none">{t}</span>
  const col = ' flex flex-col items-center gap-1'
  const cloud = String(s.cLOUD) === '1'
  const singers = s.sINGER.split(/\s*,\s*/).filter(Boolean) // the box joins co-singers with a bare comma; wrap between singers, not inside a name
  return (
    <li className={`relative flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900`}>
      {cloud && <span title="Cloud song: downloads when requested" className="absolute -left-1 -top-2 z-[1] flex items-center gap-1 text-[9px] font-semibold uppercase leading-none tracking-wide text-sky-500 drop-shadow"><Icon name="cloud" className="size-5 fill-current" />{helperLabels && <span>Cloud</span>}</span>}
      <div className="min-w-0 flex-1">
        <div style={fit(s.sONGNAME, 16, 34, 13)} className="break-words font-medium leading-snug">{s.sONGNAME}</div>
        <div style={fit(s.sINGER, 14, 40, 11)} className="break-words text-zinc-500">{singers.map((n, i) => <span key={i}><span className="inline-block max-w-full">{n}{i < singers.length - 1 && ','}</span>{' '}</span>)}</div>
      </div>
      {queue ? <>
        <button className={btn + col} title="Play next" onClick={() => act('Pro2', s.xH, `Playing next · ${s.sONGNAME}`, 'next')}><Icon name="next" />{lbl('Next')}</button>
        <button className={btn + col} title="Remove" onClick={() => act('Del1', s.xH, `Removed · ${s.sONGNAME}`, 'remove')}><Icon name="remove" />{lbl('Remove')}</button>
      </> : <>
        <button className={btn + col} title="Play next" onClick={() => act('Pro1', s.sONGBM, cloud ? `Cloud request sent · plays next · ${s.sONGNAME}` : `Playing next · ${s.sONGNAME}`, cloud ? 'cloud' : 'next')}><Icon name="next" />{lbl('Next')}</button>
        <button className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white flex flex-col items-center gap-1 transition duration-150 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-lg hover:shadow-accent/40 active:translate-y-0 active:scale-90" title="Add to queue" onClick={() => act('Add1', s.sONGBM, cloud ? `Cloud request sent · queued · ${s.sONGNAME}` : `Added · ${s.sONGNAME}`, cloud ? 'cloud' : 'add')}><Icon name="add" />{lbl('Add')}</button>
      </>}
    </li>
  )
}

function Pill({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`rounded-full px-4 py-1.5 text-sm transition duration-150 hover:scale-105 active:scale-95 ${on ? 'bg-accent text-white' : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{children}</button>
}

function FilterPanel({ tab, filter, setFilter, area, setArea, close }: {
  tab: string; filter: Filter; setFilter: (f: Filter) => void; area: number; setArea: (a: number) => void; close: () => void
}) {
  const groups: [string, ReactNode[]][] = tab === 'songs'
    ? [['', [<Pill key="all" on={!Object.keys(filter).length} onClick={() => { setFilter({}); close() }}>All</Pill>]],
       ...FILTERS.map(([g, items]): [string, ReactNode[]] => [g, items.map(([n, f]) =>
         <Pill key={n} on={fkey(f) === fkey(filter)} onClick={() => { setFilter(f); close() }}>{n}</Pill>)])]
    : [['Region', AREAS.map((n, i) => <Pill key={n} on={i === area} onClick={() => { setArea(i); close() }}>{n}</Pill>)]]
  return (
    <div data-popup className="animate-pop pointer-events-auto absolute inset-x-3 top-[4.75rem] max-h-[calc(100dvh-10.25rem)] space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 pb-5 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10 sm:inset-x-auto sm:left-1/2 sm:w-[36rem] sm:max-w-[calc(100vw-1.5rem)] sm:-translate-x-1/2 md:max-h-[calc(100dvh-7rem)]">
      {groups.map(([g, pills]) => (
        <section key={g}>{g && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g}</h3>}
          <div className="flex flex-wrap gap-2">{pills}</div></section>
      ))}
    </div>
  )
}

function Landing({ host, onConnected }: { host: string | null; onConnected: (h: string) => void }) {
  const [ip, setIp] = useState(host?.replace('http://', '') ?? '')
  const [busy, setBusy] = useState<'connect' | 'scan' | null>(null)
  const [err, setErr] = useState('')
  const [found, setFound] = useState<string[] | null>(null)
  const connect = (v: string) => {
    setBusy('connect'); setErr('')
    setHost(v).then(onConnected).catch(e => setErr(e.message)).finally(() => setBusy(null))
  }
  const scan = () => {
    setBusy('scan'); setErr(''); setFound(null)
    scanNetwork().then(f => { setFound(f); if (f.length === 1) connect(f[0]) }).catch(() => setErr("Scan failed. Enter the address instead.")).finally(() => setBusy(b => (b === 'scan' ? null : b)))
  }
  const ready = useRef(false)
  useEffect(() => { if (!ready.current && !host) scan(); ready.current = true }, []) // eslint-disable-line
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-accent">KTV</h1>
        <p className="mt-1 text-zinc-500">{host ? `Can't reach the KTV machine at ${host.replace('http://', '')}. Still retrying in the background.` : 'Connect to your KTV machine to get started.'}</p>
      </div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); ip.trim() && connect(ip) }}>
        <input value={ip} onChange={e => setIp(e.target.value)} inputMode="decimal" autoFocus placeholder="192.168.1.50" aria-label="KTV machine IP address"
          className="min-w-0 flex-1 rounded-xl bg-zinc-200 px-4 py-3 outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800" />
        <button disabled={!!busy} className="rounded-xl bg-accent px-5 py-3 font-semibold text-white transition active:scale-95 disabled:opacity-50">{busy === 'connect' ? 'Checking…' : 'Connect'}</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-500">{err}</p>}
      <div>
        <button disabled={!!busy} onClick={scan} className={btn + ' w-full disabled:opacity-50'}>{busy === 'scan' ? 'Scanning your network…' : 'Search my network'}</button>
        {found?.length === 0 && <p className="mt-3 text-sm text-zinc-500">No KTV machine found on this network. Check that it is on and enter its address above.</p>}
        {!!found?.length && found.length > 1 && <ul className="mt-3 grid gap-2">{found.map(f => <li key={f}><button disabled={!!busy} onClick={() => connect(f)} className={btn + ' w-full text-left'}>{f.replace('http://', '')}</button></li>)}</ul>}
      </div>
    </div>
  )
}

function Songs({ q, act, filter, epoch }: { q: string; act: Act; filter: Filter; epoch: number }) {
  const p = usePaged(page => searchSongs(q, filter, page), [q, fkey(filter), epoch])
  return (
    <>
      <ul className="grid gap-2 xl:grid-cols-2">{p.items.map((s, i) => <SongRow key={`${s.sONGBM}-${i}`} s={s} act={act} />)}</ul>
      <Status state={p.state} empty={!p.items.length} hasMore={p.hasMore} more={p.more} retry={p.retry} />
    </>
  )
}

function SingerCard({ s, onPick }: { s: Singer; onPick: () => void }) {
  const { hideAltNames } = useContext(SettingsCtx)
  return (
    <li>
      <button onClick={onPick} className="flex w-full flex-col items-center gap-2 rounded-xl p-2 transition duration-150 hover:-translate-y-0.5 hover:bg-zinc-200/60 active:scale-95 dark:hover:bg-zinc-800/60">
        <img src={singerImg(s.picture)} alt="" loading="lazy" onError={e => (e.currentTarget.style.visibility = 'hidden')}
          className="aspect-square w-full max-w-28 rounded-full bg-zinc-200 object-cover dark:bg-zinc-800" />
        {/* no truncation: names wrap, native-script name stays whole, romanised name underneath */}
        <span className="break-words text-center text-sm font-medium leading-tight">{s.name}</span>
        {s.qt_name && !hideAltNames && <span className="break-words text-center text-xs leading-tight text-zinc-500">{s.qt_name}</span>}
      </button>
    </li>
  )
}

function Singers({ q, area, onPick, epoch }: { q: string; area: number; onPick: (name: string) => void; epoch: number }) {
  const p = usePaged(page => searchSingers(q, area, page), [q, area, epoch])
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
        {p.items.map(s => <SingerCard key={s.name} s={s} onPick={() => onPick(s.name)} />)}
      </ul>
      <Status state={p.state} empty={!p.items.length} hasMore={p.hasMore} more={p.more} retry={p.retry} />
    </>
  )
}

function Queue({ items, act }: { items: Song[]; act: Act }) {
  if (!items.length) return <p className="p-6 text-center text-zinc-500">Queue is empty.</p>
  return (
    <ul className="grid gap-2">
      {items.map(s => <SongRow key={s.xH} s={s} act={act} queue />)}
    </ul>
  )
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-6"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
    <div className="grid grid-cols-2 gap-2">{children}</div></section>
)

function Remote({ act }: { act: Act }) {
  const { showMic } = useContext(SettingsCtx)
  const b = (label: string, c: string, icon?: Parameters<typeof Icon>[0]['name'], wide = false) => (
    <button key={c} className={`${btn} flex items-center justify-center gap-2 ${wide ? 'col-span-2' : ''}`} onClick={() => act(c)}>{icon && <Icon name={icon} className="size-4" />}{label}</button>
  )
  return (
    <div>
      <Group title="Vocal track">{[b('Original / Karaoke', 'MuOr', 'karaoke', true)]}</Group>
      <Group title="Playback">{[b('Skip', 'Skip', 'skip'), b('Replay', 'Reset', 'replay'), b('Play / Pause', 'Play', 'play'), b('Mute', 'Mute', 'mute')]}</Group>
      <Group title="Music">{[b('Vol +', 'Music_volUp'), b('Vol −', 'Music_volDown'), b('Key ♯', 'Music_toneUp'), b('Key ♭', 'Music_toneDown')]}</Group>
      {showMic && <Group title="Mic">{[b('Vol +', 'Mic_volUp'), b('Vol −', 'Mic_volDown'), b('Echo +', 'Mic_echoUp'), b('Echo −', 'Mic_echoDown'), b('Reverb +', 'Mic_reverbUp'), b('Reverb −', 'Mic_reverbDown')]}</Group>}
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
      {label}
      <span className={`h-6 w-11 rounded-full p-0.5 transition-colors ${on ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
        <span className={`block size-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  )
}

function SettingsMenu({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  return (
    <div data-popup>
      <button className={btn} aria-label="Settings" onClick={() => setOpen(!open)}><Icon name="settings" /></button>
    </div>
  )
}

// Fixed (not inside the header) so it opens at the same y as the filter popup.
function SettingsPanel({ t }: { t: ReturnType<typeof useTheme> }) {
  const st = useContext(SettingsCtx) as ReturnType<typeof useSettingsState>
  return (
    <div data-popup className="animate-pop pointer-events-auto absolute right-3 top-[4.75rem] w-64 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Style</h3>
      <div className="flex gap-1">
        {(['system', 'light', 'dark'] as Mode[]).map(m => (
          <button key={m} onClick={() => t.setMode(m)} className={`flex-1 rounded-lg py-1.5 text-sm capitalize transition active:scale-95 ${t.mode === m ? 'bg-accent text-white hover:brightness-110' : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{m}</button>
        ))}
      </div>
      <div className="flex justify-between">
        {Object.entries(ACCENTS).map(([name, hex]) => (
          <button key={name} aria-label={name} onClick={() => t.setAccent(name as keyof typeof ACCENTS)}
            style={{ background: hex }} className={`size-8 rounded-full transition duration-150 hover:scale-110 active:scale-90 ${t.accent === name ? 'ring-2 ring-offset-2 ring-zinc-500 dark:ring-offset-zinc-900' : ''}`} />
        ))}
      </div>
      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Display</h3>
      <Toggle label="Opaque toolbars" on={st.opaqueBars} onClick={() => st.toggle('opaqueBars')} />
      <Toggle label="SVG icons" on={st.svgIcons} onClick={() => st.toggle('svgIcons')} />
      <Toggle label="Helper labels" on={st.helperLabels} onClick={() => st.toggle('helperLabels')} />
      <Toggle label="Hide secondary names" on={st.hideAltNames} onClick={() => st.toggle('hideAltNames')} />
      <Toggle label="Longer popups" on={st.longPopups} onClick={() => st.toggle('longPopups')} />
      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Remote</h3>
      <Toggle label="Show mic controls" on={st.showMic} onClick={() => st.toggle('showMic')} />
    </div>
  )
}

const TABS = [['songs', 'Songs'], ['singers', 'Singers'], ['queue', 'Queue']] as const
type Tab = (typeof TABS)[number][0]

export default function Root() {
  const st = useSettingsState()
  return <SettingsCtx.Provider value={st}><App /></SettingsCtx.Provider>
}

function App() {
  const theme = useTheme() // must live here: it applies dark mode/accent to the page, so it has to stay mounted
  const { opaqueBars, longPopups } = useContext(SettingsCtx)
  const [tab, setTab] = useState<Tab>('songs')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>({})
  const [area, setArea] = useState(0)
  const [menu, setMenu] = useState<'filter' | 'theme' | 'remote' | null>(null)
  useEffect(() => {
    const h = (e: PointerEvent) => !(e.target as Element).closest('[data-popup]') && setMenu(null)
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])
  const [queue, setQueue] = useState<{ items: Song[]; count: number }>({ items: [], count: 0 })
  const [toast, setToast] = useState<{ text: string; icon?: IconName; tone?: 'accent' | 'cloud' | 'error'; on: boolean }>({ text: '', on: false })
  const toastTimer = useRef<number>(0)

  const activeLabel = tab === 'songs' ? (filter.singer ? filter.singer : filterName(filter)) : area > 0 ? AREAS[area] : undefined
  useEffect(() => { document.body.style.overflow = menu ? 'hidden' : '' }, [menu])

  // null = first poll pending. Poll results double as the server health check; the last good queue is kept while down.
  const [online, setOnline] = useState<boolean | null>(null)
  const [epoch, setEpoch] = useState(0) // bumps when the box comes back after an outage, so failed searches reload
  const wasDown = useRef(false)
  const [fails, setFails] = useState(0) // consecutive failed polls; a few in a row means a real outage, not a blip
  const [cfgHost, setCfgHost] = useState<string | null | undefined>(undefined) // undefined = not loaded yet
  useEffect(() => { getHost().then(setCfgHost).catch(() => setCfgHost(undefined)) }, [])
  const refresh = useCallback(() => getQueue().then(q => {
    setQueue(q); setOnline(true); setFails(0)
    if (wasDown.current) { wasDown.current = false; setEpoch(e => e + 1) }
  }).catch(() => { wasDown.current = true; setOnline(false); setFails(f => f + 1) }), [])
  const total = queue.items.length
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [refresh])

  const act: Act = (cmd, val = '', label, icon) => {
    const show = (text: string, i?: IconName, tone?: 'error') => {
      // Pill mirrors the pressed button: Add is accent-filled, everything else neutral.
      setToast({ text, icon: i, tone: tone ?? (i === 'cloud' ? 'cloud' : cmd === 'Add1' ? 'accent' : undefined), on: true })
      clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(t => ({ ...t, on: false })), longPopups ? 4500 : 2500)
    }
    command(cmd, val).then(() => { show(label ?? cmd, icon); refresh() }).catch(() => { show("Can't reach the KTV machine", undefined, 'error'); refresh() })
  }

  const item = (on: boolean, extra = '') => `flex flex-1 flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs transition duration-150 active:scale-95 md:flex-none md:flex-row md:gap-2 md:text-sm ${on ? 'bg-accent/15 font-bold text-accent' : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'} ${extra}`
  const tabs = (cls: string) => (
    <nav className={cls}>
      {TABS.map(([k, label]) => (
        <button key={k} onClick={() => { setTab(k); setMenu(null) }} className={item(tab === k, k === 'queue' ? 'lg:hidden' : '')}>
          <span className="relative">
            <Icon name={k} className="size-5 md:size-4" />
            {k === 'queue' && total > 0 && <span className="absolute -right-3 -top-2 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white">{total}</span>}
          </span>
          <span className="whitespace-nowrap">{label}</span>
        </button>
      ))}
      <button data-popup onClick={() => setMenu(menu === 'remote' ? null : 'remote')} className={item(menu === 'remote', 'md:hidden')}>
        <Icon name="remote" className="size-5 md:size-4" /><span>Remote</span>
      </button>
    </nav>
  )

  if (cfgHost === null || fails >= 3)
    return <Landing host={cfgHost ?? null} onConnected={h => { setCfgHost(h); setFails(0); refresh() }} />

  return (
    <div className="mx-auto min-h-dvh max-w-7xl pb-28 md:pb-6">
      {menu && <div className="animate-fade pointer-events-none fixed inset-0 z-[5] bg-black/40 max-md:pointer-events-auto" />}
      <header className={`sticky top-0 z-10 flex items-center gap-3 p-3 ${opaqueBars ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-zinc-50/90 backdrop-blur dark:bg-zinc-950/90'}`}>
        <h1 className="hidden text-lg font-bold text-accent sm:block">KTV</h1>
        {tabs('hidden md:flex md:gap-2')}
        {(tab === 'songs' || tab === 'singers') &&
          <div className="min-w-0 flex-1" data-popup>
            <div className="relative">
            <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder={tab === 'songs' ? 'Search songs…' : 'Search singers…'}
              className="w-full rounded-xl bg-zinc-200 py-3 pl-4 pr-40 outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800" />
            <button aria-label="Filters" onClick={() => setMenu(menu === 'filter' ? null : 'filter')}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition duration-150 hover:brightness-110 active:scale-95 after:content-['▾'] ${activeLabel ? 'bg-accent text-white' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                <span className="block max-w-28 truncate">{activeLabel ?? 'Filter'}</span>
              </button>
            </div>
          </div>}
        <div className="ml-auto flex items-center gap-2">
          <button data-popup className={`${btn} hidden md:block ${menu === 'remote' ? '!bg-accent text-white' : ''}`} aria-label="Remote" title="Remote" onClick={() => setMenu(menu === 'remote' ? null : 'remote')}><Icon name="remote" /></button>
          <SettingsMenu open={menu === 'theme'} setOpen={o => setMenu(o ? 'theme' : null)} />
        </div>
      </header>
      {online !== true && (
        <div role="status" className={`mx-3 mb-2 rounded-xl px-4 py-2 text-sm ${online === false ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800'}`}>
          {online === false ? "Can't reach the KTV machine. Retrying…" : 'Connecting to the KTV machine…'}
        </div>
      )}

      <div className="flex gap-6 px-3">
        <main className="min-w-0 flex-1">
          {tab === 'songs' && <Songs q={q} act={act} filter={filter} epoch={epoch} />}
          {tab === 'singers' && <Singers epoch={epoch} q={q} area={area} onPick={name => { setFilter({ singer: name }); setQ(''); setTab('songs') }} />}
          {tab === 'queue' && <Queue items={queue.items} act={act} />}
        </main>
        <aside className="sticky top-20 hidden h-[calc(100dvh-6rem)] w-96 shrink-0 overflow-y-auto lg:block">
          <h2 className="mb-2 font-semibold">Queue ({total})</h2>
          <Queue items={queue.items} act={act} />
        </aside>
      </div>

      {tabs('fixed inset-x-3 bottom-3 z-10 flex gap-1 rounded-2xl border border-zinc-200/70 p-1.5 shadow-xl shadow-black/10 dark:border-zinc-700/60 md:hidden ' + (opaqueBars ? 'bg-white dark:bg-zinc-900' : 'bg-white/85 backdrop-blur dark:bg-zinc-900/85'))}
      {/* same width/centering as the page container so popups line up with the header on wide screens */}
      <div className="pointer-events-none fixed inset-0 z-20 mx-auto max-w-7xl">
      {menu === 'filter' && <FilterPanel tab={tab} filter={filter} setFilter={setFilter} area={area} setArea={setArea} close={() => setMenu(null)} />}
      {menu === 'theme' && <SettingsPanel t={theme} />}
      {menu === 'remote' && (
        <div data-popup className="animate-pop pointer-events-auto absolute inset-x-3 bottom-[5.5rem] max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10 md:inset-x-auto md:bottom-auto md:right-3 md:top-[4.75rem] md:max-h-[calc(100dvh-6rem)] md:w-96">
          <Remote act={act} />
        </div>
      )}
      </div>
      <div className={`pointer-events-none fixed left-1/2 top-20 z-30 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full px-5 py-2 shadow-lg transition-all duration-300 ${toast.tone === 'error' ? 'bg-red-500 text-white' : toast.tone === 'cloud' ? 'bg-sky-500 text-white' : toast.tone === 'accent' ? 'bg-accent text-white' : 'bg-zinc-200 text-zinc-900 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10'} ${toast.on ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}>
        {toast.icon && <Icon name={toast.icon} className="size-4 shrink-0" />}<span className="truncate">{toast.text}</span>
      </div>
    </div>
  )
}
