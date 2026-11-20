import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addCategory, addFavorite, command, deleteCategory, getCategories, getHost, getList, getQueue, searchList, type ListName, recordHistory, removeFavorite, renameCategory, reorderCategories, setSongCategory, scanNetwork, setHost, searchSingers, searchSongs, singerImg, type Category, type DeleteSongs, type Filter, type Singer, type Song } from './api'
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
type CatFilter = 'all' | 'none' | number // favorites filter: everything, songs in no category, or one category id
const fkey = (f: Filter) => JSON.stringify(f)
const filterName = (f: Filter) => FILTERS.flatMap(([, i]) => i).find(([, x]) => fkey(x) === fkey(f))?.[0]

const btn = 'rounded-xl bg-zinc-200 px-4 py-3 text-sm font-medium active:bg-accent active:text-white hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-90'

// Debounced, paged fetch; stale responses are dropped.
function usePaged<T>(fetcher: (page: number) => Promise<{ items: T[]; maxPage: number }>, deps: unknown[], keyOf?: (t: T) => unknown) {
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
    fetcher(p).then(r => { // keyOf: pages can repeat a row
      if (id !== req.current) return
      setItems(prev => { const all = p ? [...prev, ...r.items] : r.items; return keyOf ? [...new Map(all.map(t => [keyOf(t), t])).values()] : all });
      setPage(p); setMax(r.maxPage); setState('idle')
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

type Act = (action: string, val?: string, label?: string, icon?: IconName, song?: Song) => void
// open: show the category picker (which also favorites/unfavorites; hold). add: favorite it (double tap); true if it did.
type Favs = { has: (s: Song) => boolean; open: (s: Song) => void; add: (s: Song) => boolean }

// Row gestures: hold (500 ms, or right-click) fires onHold and swallows the click after it; two clicks within 300 ms fire onDouble.
// `holding` turns on shortly after the press (not at once, so double taps don't flash it) while a hold builds up. Presses on the row's own buttons are ignored.
const HOLD_MS = 500
function useRowGesture(onHold: () => void, onDouble: (x: number, y: number) => void) {
  const [holding, setHolding] = useState(false)
  const timer = useRef(0), show = useRef(0), held = useRef(false), last = useRef(0), from = useRef([0, 0])
  const stop = () => { clearTimeout(timer.current); clearTimeout(show.current); setHolding(false) }
  const fire = () => { held.current = true; stop(); onHold() }
  const own = (e: React.SyntheticEvent) => !!(e.target as HTMLElement).closest('button')
  return {
    holding,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (own(e)) return
        held.current = false; from.current = [e.clientX, e.clientY]
        stop(); timer.current = window.setTimeout(fire, HOLD_MS); show.current = window.setTimeout(() => setHolding(true), 150)
      },
      onPointerMove: (e: React.PointerEvent) => { if (Math.hypot(e.clientX - from.current[0], e.clientY - from.current[1]) > 10) stop() }, // it's a scroll or drag
      onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
      onClick: (e: React.MouseEvent) => {
        if (own(e)) return
        if (held.current) { held.current = false; return }
        const now = Date.now()
        if (now - last.current < 300) { last.current = 0; onDouble(e.clientX, e.clientY) } else last.current = now
      },
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!held.current) fire() }, // touch long-press raises this too
    },
  }
}

// Scale font down continuously once text passes `from` width units (CJK glyphs count double), never below `min` px.
const fit = (t: string, base: number, from: number, min: number) => {
  const w = [...t].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  return { fontSize: Math.max(min, Math.min(base, (base * from) / w)) }
}

// Cloud songs being downloaded, and ones already stored (those queue like normal songs).
const CloudCtx = createContext({ pending: new Set<string>(), downloaded: new Set<string>() })

function SongRow({ s, act, queue, favs, downloading, first }: { s: Song; act: Act; queue?: boolean; favs?: Favs; downloading?: boolean; first?: boolean }) {
  const { helperLabels } = useContext(SettingsCtx)
  const lbl = (t: string) => helperLabels && <span className="text-[10px] font-normal leading-none">{t}</span>
  const col = ' flex flex-col items-center gap-1'
  const { pending, downloaded } = useContext(CloudCtx)
  const cloud = String(s.cLOUD) === '1' && (downloading || !queue) && !downloaded.has(String(s.sONGBM)) // the flag stays 1 after the download
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null) // where the double tap landed; plays the heart animation
  const g = useRowGesture(() => favs?.open(s), (x, y) => { if (favs?.add(s)) setPop({ x, y }) })
  const liked = !queue && !!favs?.has(s)
  const singers = s.sINGER.split(/\s*,\s*/).filter(Boolean) // the box joins co-singers with a bare comma; wrap between singers, not inside a name
  return (
    <li {...(queue || !favs ? {} : g.handlers)} tabIndex={queue || !favs ? undefined : 0} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && favs?.open(s)}
      className={`relative flex touch-manipulation select-none items-center gap-3 rounded-xl bg-white p-3 shadow-sm transition-[box-shadow,background-color] hover:shadow-md dark:bg-zinc-900 ${g.holding ? 'bg-accent/5 ring-2 ring-accent/40 duration-300' : 'duration-150'} ${downloading ? 'opacity-60' : ''}`}>
      {(liked || cloud) && <span className="absolute -left-1 -top-2 z-[1] flex items-center gap-1 drop-shadow">
        {liked && <Icon name="favorites" className={`size-5 fill-current text-pink-500 ${pop ? 'animate-heart-pop' : ''}`} />}
        {cloud && <span title="Cloud song: downloads when requested" className="flex items-center gap-1 text-[9px] font-semibold uppercase leading-none tracking-wide text-sky-500"><Icon name="cloud" className="size-5 fill-current" />{helperLabels && <span>Cloud</span>}</span>}
      </span>}
      {pop && <div onAnimationEnd={() => setPop(null)} style={{ left: pop.x, top: pop.y }} className="animate-heart-burst pointer-events-none fixed z-[2] -ml-6 -mt-6 text-pink-500"><Icon name="favorites" className="size-12 fill-current" /></div> /* fixed: an absolute one could stretch the page */}
      <div className="min-w-0 flex-1">
        <div style={fit(s.sONGNAME, 16, 34, 13)} className="break-words font-medium leading-snug">{s.sONGNAME}</div>
        <div style={fit(s.sINGER, 14, 40, 11)} className="break-words text-zinc-500">{singers.map((n, i) => <span key={i}><span className="inline-block max-w-full">{n}{i < singers.length - 1 && ','}</span>{' '}</span>)}</div>
      </div>
      {downloading ? <span className="flex items-center gap-2 px-2 text-xs font-medium text-sky-500"><Icon name="loading" className="size-4 animate-spin" />Downloading</span> : queue ? <>
        <button disabled={first} className={btn + col + ' disabled:pointer-events-none disabled:opacity-40'} title="Play next" onClick={() => act('move-next', s.xH, `Playing next · ${s.sONGNAME}`, 'next')}><Icon name="next" />{lbl('Next')}</button>
        <button className={btn + col} title="Remove" onClick={() => act('remove', s.xH, `Removed · ${s.sONGNAME}`, 'remove')}><Icon name="remove" />{lbl('Remove')}</button>
      </> : cloud ? (
        <button disabled={pending.has(String(s.sONGBM))} className="flex flex-col items-center gap-1 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition duration-150 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-lg hover:shadow-sky-500/40 active:translate-y-0 active:scale-90 disabled:pointer-events-none disabled:opacity-40" title="Request download" onClick={() => act('add-song', s.sONGBM, `Cloud request sent · queued · ${s.sONGNAME}`, 'cloud', s)}><Icon name="download" />{lbl('Request')}</button>
      ) : <>
        <button className={btn + col} title="Play next" onClick={() => act('play-song-next', s.sONGBM, `Playing next · ${s.sONGNAME}`, 'next', s)}><Icon name="next" />{lbl('Next')}</button>
        <button className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white flex flex-col items-center gap-1 transition duration-150 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-lg hover:shadow-accent/40 active:translate-y-0 active:scale-90" title="Add to queue" onClick={() => act('add-song', s.sONGBM, `Added · ${s.sONGNAME}`, 'add', s)}><Icon name="add" />{lbl('Add')}</button>
      </>}
    </li>
  )
}

function Pill({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`rounded-full px-4 py-1.5 text-sm transition duration-150 hover:scale-105 active:scale-95 ${on ? 'bg-accent text-white' : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{children}</button>
}

function FilterPanel({ tab, filter, setFilter, area, setArea, cats, catFilter, setCatFilter, close }: {
  tab: string; filter: Filter; setFilter: (f: Filter) => void; area: number; setArea: (a: number) => void
  cats: Category[]; catFilter: CatFilter; setCatFilter: (c: CatFilter) => void; close: () => void
}) {
  const pick = (c: CatFilter) => { setCatFilter(c); close() }
  const groups: [string, ReactNode[]][] = tab === 'favorites'
    ? [['Category', [
        <Pill key="all" on={catFilter === 'all'} onClick={() => pick('all')}>All</Pill>,
        ...cats.map(c => <Pill key={c.id} on={catFilter === c.id} onClick={() => pick(c.id)}>{c.name}</Pill>),
        <Pill key="none" on={catFilter === 'none'} onClick={() => pick('none')}>Uncategorized</Pill>]]]
    : tab === 'songs'
    ? [['', [<Pill key="all" on={!Object.keys(filter).length} onClick={() => { setFilter({}); close() }}>All</Pill>]],
       ...FILTERS.map(([g, items]): [string, ReactNode[]] => [g, items.map(([n, f]) =>
         <Pill key={n} on={fkey(f) === fkey(filter)} onClick={() => { setFilter(f); close() }}>{n}</Pill>)])]
    : [['Region', AREAS.map((n, i) => <Pill key={n} on={i === area} onClick={() => { setArea(i); close() }}>{n}</Pill>)]]
  return (
    <div data-popup className="animate-pop pointer-events-auto mt-16 max-h-[calc(100%-4rem)] w-full max-w-xl space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 pb-5 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10 self-start md:absolute md:left-1/2 md:top-[4.75rem] md:mt-0 md:max-h-[calc(100dvh-7rem)] md:w-[36rem] md:max-w-[calc(100vw-1.5rem)] md:-translate-x-1/2">
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

function Songs({ q, act, filter, epoch, favs }: { q: string; act: Act; filter: Filter; epoch: number; favs: Favs }) {
  const p = usePaged(page => searchSongs(q, filter, page), [q, fkey(filter), epoch], s => s.sONGBM)
  return (
    <>
      <ul className="grid gap-2 xl:grid-cols-2">{p.items.map((s, i) => <SongRow key={`${s.sONGBM}-${i}`} s={s} act={act} favs={favs} />)}</ul>
      <Status state={p.state} empty={!p.items.length} hasMore={p.hasMore} more={p.more} retry={p.retry} />
    </>
  )
}

function SavedList({ name, items, q, act, favs, empty }: { name: ListName; items: Song[]; q: string; act: Act; favs: Favs; empty: string }) {
  const n = q.trim().toLowerCase()
  // the server matches (incl. pinyin); until it answers, or if it can't, fall back to plain text
  const [hits, setHits] = useState<{ ids: Set<string> } | null>(null) // kept while typing, so the list doesn't blank between keystrokes
  useEffect(() => {
    if (!n) { setHits(null); return }
    const t = setTimeout(() => searchList(name, n).then(l => Array.isArray(l) && setHits({ ids: new Set(l.map(s => s.sONGBM!)) })).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [name, n])
  if (!items.length) return <p className="p-6 text-center text-zinc-500">{empty}</p>
  if (n && hits) items = items.filter(s => hits.ids.has(s.sONGBM!)) // no answer yet: keep showing the unfiltered list rather than a blank
  if (!items.length) return <p className="p-6 text-center text-zinc-500">Nothing found.</p>
  return <ul className="grid gap-2 xl:grid-cols-2">{items.map(s => <SongRow key={s.sONGBM} s={s} act={act} favs={favs} />)}</ul>
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
  const p = usePaged(page => searchSingers(q, area, page), [q, area, epoch], s => s.name)
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
        {p.items.map(s => <SingerCard key={s.name} s={s} onPick={() => onPick(s.name)} />)}
      </ul>
      <Status state={p.state} empty={!p.items.length} hasMore={p.hasMore} more={p.more} retry={p.retry} />
    </>
  )
}

// A filled mic (lucide's are outline only), crossed out when `off`.
function SolidMic({ off }: { off?: boolean }) {
  const { svgIcons } = useContext(SettingsCtx)
  if (!svgIcons) return <span aria-hidden className="leading-none">{off ? '🔇' : '🎤'}</span>
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="13" rx="3" fill="currentColor" stroke="none" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  )
}

// The first four Remote panel actions.
const REMOTE_LABELS: Record<string, string> = {
  'toggle-vocal': 'Switched Original / Karaoke', replay: 'Replaying', 'play-pause': 'Play / Pause sent', skip: 'Skipped', mute: 'Mute toggled',
  'music-volume-up': 'Music volume up', 'music-volume-down': 'Music volume down', 'music-key-up': 'Key up', 'music-key-down': 'Key down',
  'mic-volume-up': 'Mic volume up', 'mic-volume-down': 'Mic volume down', 'mic-echo-up': 'Echo up', 'mic-echo-down': 'Echo down',
  'mic-reverb-up': 'Reverb up', 'mic-reverb-down': 'Reverb down',
}
const PLAYER_CONTROLS: [string, string, IconName, boolean?][] = [['Original / Karaoke', 'toggle-vocal', 'karaoke'], ['Replay', 'replay', 'restart', true], ['Play / Pause', 'play-pause', 'play', true], ['Skip', 'skip', 'skip', true]]
function Queue({ items, pending, current, act }: { items: Song[]; pending: Song[]; current: Song | null; act: Act }) {
  const { playerControls } = useContext(SettingsCtx)
  return (
    <>
      <div className={`mb-2 rounded-xl px-4 py-3 transition-colors ${current ? 'bg-accent/15' : 'bg-zinc-200/60 dark:bg-zinc-800/60'}`}>
        <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wide text-accent`}>Now playing</div>
          {current
            ? <><div className="break-words font-medium leading-snug">{current.sONGNAME}</div><div className="break-words text-zinc-500">{current.sINGER}</div></>
            : <><div className="font-medium leading-snug text-zinc-400">Nothing playing right now</div><div className="text-zinc-400">-</div></>}
        </div>
        <div aria-hidden className={`relative size-14 shrink-0 rounded-full ${current ? 'animate-spin bg-zinc-900 dark:bg-zinc-950' : 'bg-zinc-400 dark:bg-zinc-700'}`} style={current ? { animationDuration: '3s' } : undefined}>
          <div className="absolute inset-1.5 rounded-full border border-white/10" />
          <div className="absolute inset-3 rounded-full border border-white/10" />
          <div className={`absolute inset-[18px] rounded-full ${current ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-500'}`} />
          <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          <div className="absolute left-1.5 top-1/2 h-0.5 w-2 -translate-y-1/2 rounded bg-white/30" />
        </div>
        </div>
        {playerControls && <div className="mt-3 flex flex-wrap gap-2">
          {PLAYER_CONTROLS.map(([label, c, icon, solid]) => (
            <button key={c} disabled={!current} className={`flex flex-1 items-center justify-center rounded-xl bg-white/80 px-3 py-2 text-accent shadow-sm transition duration-150 hover:bg-white hover:shadow-md active:scale-90 active:bg-accent active:text-white dark:bg-zinc-900/70 dark:hover:bg-zinc-900 disabled:pointer-events-none disabled:bg-zinc-300/40 disabled:text-zinc-400 disabled:shadow-none dark:disabled:bg-zinc-700/30 dark:disabled:text-zinc-600`} title={label} aria-label={label} onClick={() => act(c)}>{c === 'toggle-vocal' ? <><SolidMic /><span className="mx-2 h-4 w-px bg-current opacity-30" /><SolidMic off /></> : <Icon name={icon} className={`size-4 ${solid ? 'fill-current' : ''}`} />}</button>
          ))}
        </div>}
      </div>
      <ul className="grid gap-2">
        {items.map((s, i) => <SongRow key={s.xH} s={s} act={act} queue first={i === 0} />)}
        {pending.map((s, i) => <SongRow key={'dl' + i} s={s} act={act} queue downloading />)}
      </ul>
    </>
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
      <Group title="Vocal track">{[b('Original / Karaoke', 'toggle-vocal', 'karaoke', true)]}</Group>
      <Group title="Playback">{[b('Skip', 'skip', 'skip'), b('Replay', 'replay', 'replay'), b('Play / Pause', 'play-pause', 'play'), b('Mute', 'mute', 'mute')]}</Group>
      <Group title="Music">{[b('Vol +', 'music-volume-up'), b('Vol −', 'music-volume-down'), b('Key ♯', 'music-key-up'), b('Key ♭', 'music-key-down')]}</Group>
      {showMic && <Group title="Mic">{[b('Vol +', 'mic-volume-up'), b('Vol −', 'mic-volume-down'), b('Echo +', 'mic-echo-up'), b('Echo −', 'mic-echo-down'), b('Reverb +', 'mic-reverb-up'), b('Reverb −', 'mic-reverb-down')]}</Group>}
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
function SettingsPanel({ t, onManage }: { t: ReturnType<typeof useTheme>; onManage: () => void }) {
  const st = useContext(SettingsCtx) as ReturnType<typeof useSettingsState>
  return (
    <div data-popup className="animate-pop pointer-events-auto mt-16 max-h-[calc(100%-4rem)] w-full max-w-xl space-y-3 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10 self-start md:absolute md:right-3 md:top-[4.75rem] md:mt-0 md:w-96 md:max-h-none md:max-w-[calc(100vw-1.5rem)] md:overflow-visible">
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
      <Toggle label="Player controls on Now playing" on={st.playerControls} onClick={() => st.toggle('playerControls')} />
      <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Favorites</h3>
      <button onClick={onManage} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"><Icon name="tag" className="size-4" />Manage categories</button>
    </div>
  )
}

// A tap that closes a popup by its backdrop must not also click whatever sits under it (the close happens on pointerdown, the click comes after).
const swallowNextClick = () => {
  const stop = (e: Event) => e.stopPropagation()
  window.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', stop, true), 400) // no click followed (e.g. a scroll), so don't eat a later one
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  // On phones the on-screen keyboard (or a bottom URL bar) covers part of the layout viewport; fit the visual viewport instead.
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const f = () => setVv({ top: v.offsetTop, height: v.height })
    f(); v.addEventListener('resize', f); v.addEventListener('scroll', f)
    return () => { v.removeEventListener('resize', f); v.removeEventListener('scroll', f) }
  }, [])
  return (
    <div style={vv ? { top: vv.top, height: vv.height, bottom: 'auto' } : undefined} className={`fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3`} onPointerDown={e => { if (e.target === e.currentTarget) { swallowNextClick(); onClose() } }}>
      <div role="dialog" aria-label={title} className="animate-pop max-h-full w-full max-w-sm space-y-3 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words font-semibold">{title}</h3>
            {subtitle && <p className="break-words text-sm text-zinc-500">{subtitle}</p>}
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Icon name="remove" className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const nSongs = (n: number) => `${n} song${n === 1 ? '' : 's'}`

// song may not be a favorite yet (fav is undefined); picking a category or the heart favorites it.
function CategoryPicker({ song, fav, cats, setCat, toggle, onEdit, onClose }: { song: Song; fav?: Song; cats: Category[]; setCat: (id: number, on: boolean) => void; toggle: () => void; onEdit: () => void; onClose: () => void }) {
  return (
    <Modal title={song.sONGNAME} subtitle={song.sINGER} onClose={onClose}>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500"><Icon name="tag" className="size-3.5" />Categories</h4>
      {cats.length ? (
        <div className="flex flex-wrap gap-2">
          {cats.map(c => { const on = !!fav?.cats?.includes(c.id); return (
            <button key={c.id} aria-pressed={on} onClick={() => setCat(c.id, !on)} className={`rounded-xl px-3 py-2 text-sm transition duration-150 active:scale-95 ${on ? 'bg-accent text-white hover:brightness-110' : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{c.name}</button>) })}
        </div>
      ) : <p className="text-sm text-zinc-500">No categories yet. Use Edit categories to add some.</p>}
      <div className="flex gap-2">
        <button onClick={onEdit} className={btn + ' flex flex-1 items-center justify-center gap-2'}><Icon name="edit" className="size-4" />Edit categories</button>
        <button aria-pressed={!!fav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} title={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={toggle} className="flex items-center justify-center rounded-xl bg-zinc-200 px-4 py-3 transition duration-150 hover:bg-zinc-300 active:scale-95 dark:bg-zinc-800 dark:hover:bg-zinc-700">
          <Icon name="favorites" className={fav ? 'size-5 fill-current text-pink-500' : 'size-5 text-zinc-500'} />
        </button>
      </div>
    </Modal>
  )
}

function ManageCategories({ cats, setCats, favs, reload, onClose }: { cats: Category[]; setCats: (f: (l: Category[]) => Category[]) => void; favs: Song[]; reload: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<Category | null>(null)
  const [del, setDel] = useState<Category | null>(null)
  const [mode, setMode] = useState<DeleteSongs>('keep')
  const [err, setErr] = useState('')
  const run = (p: Promise<unknown>, done: () => void, msg?: string) =>
    p.then(() => { setErr(''); done(); reload() }).catch(e => setErr(msg ?? e.message))
  const input = 'min-w-0 flex-1 rounded-xl bg-zinc-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800'
  const primary = 'rounded-xl bg-accent px-4 py-3 text-white transition hover:brightness-110 active:scale-95'
  const iconBtn = 'rounded-lg p-2.5 transition duration-150 hover:bg-zinc-200 active:scale-90 dark:hover:bg-zinc-700'
  // Drag a row by its grip as a floating card: rows only slide aside to show the landing spot. The order changes (and saves) on release.
  // Arrow keys on the grip move a row one step.
  const [drag, setDrag] = useState<{ id: number; from: number; to: number; y0: number; dy: number; step: number; settling?: boolean } | null>(null)
  const reordered = (from: number, to: number) => { const n = [...cats]; n.splice(to, 0, n.splice(from, 1)[0]); return n }
  // the request starts now; resolves true if it saved
  const persist = (n: Category[]) => reorderCategories(n.map(x => x.id)).then(() => true, () => false)
  const failed = () => { reload(); setErr("Couldn't save the order. Try again.") }
  const commit = (from: number, to: number) => {
    if (from === to) return
    const n = reordered(from, to)
    setCats(() => n)
    persist(n).then(ok => ok || failed())
  }
  const cardInput = input.replace('dark:bg-zinc-800', 'dark:bg-zinc-700')

  if (del) {
    const inCat = favs.filter(s => s.cats?.includes(del.id))
    const orphans = inCat.filter(s => s.cats!.length === 1).length
    const removing = mode === 'all' ? inCat.length : mode === 'orphans' ? orphans : 0
    const opts: [DeleteSongs, string, string, boolean][] = [
      ['keep', 'Keep all songs in Favorites', 'The songs stay favorited. Songs that were only in this category become Uncategorized.', false],
      ['orphans', `Also remove songs that are only in this category (${orphans})`, 'Songs that are also in another category stay favorited.', orphans === 0],
      ['all', `Also remove all ${nSongs(inCat.length)} in this category from Favorites`, 'This includes songs that are also in other categories.', false],
    ]
    return (
      <Modal title={`Delete "${del.name}"?`} onClose={onClose}>
        <p className="text-sm text-zinc-500">{inCat.length ? 'The category is removed from all songs. Choose what happens to the songs in it.' : 'No songs in this category.'}</p>
        {!!inCat.length && opts.map(([k, label, sub, off]) => (
          <label key={k} className={`flex items-start gap-2 text-sm ${off ? 'opacity-50' : ''}`}>
            <input type="radio" name="del" disabled={off} checked={mode === k} onChange={() => setMode(k)} className="mt-1 accent-accent" />
            <span><span className="font-medium">{label}</span><span className="block text-xs text-zinc-500">{sub}</span></span>
          </label>
        ))}
        <p aria-live="polite" className="min-h-5 text-sm text-red-500">{err || (removing > 0 ? `This will remove ${nSongs(removing)} from Favorites.` : '')}</p>
        <div className="flex gap-2">
          <button onClick={() => { setDel(null); setMode('keep'); setErr('') }} className={btn + ' flex-1'}>Cancel</button>
          <button onClick={() => run(deleteCategory(del.id, mode), () => { setDel(null); setMode('keep') }, "Couldn't delete. Try again.")}
            className="flex-1 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95">
            Delete category
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Categories" onClose={onClose}>
      {!cats.length && <p className="text-sm text-zinc-500">No categories yet.</p>}
      <ul className="space-y-2">
        {cats.map((c, i) => {
          const held = drag?.id === c.id
          const shift = !drag || held ? 0 : drag.from < drag.to && i > drag.from && i <= drag.to ? -drag.step : drag.to < drag.from && i >= drag.to && i < drag.from ? drag.step : 0
          // transition only mid-drag: at rest it would animate rows from their old offsets when the new order lands
          return (
          <li key={c.id} style={{ transform: held ? `translateY(${drag.dy}px)${drag.settling ? '' : ' scale(1.02)'}` : shift ? `translateY(${shift}px)` : undefined }}
            className={`relative flex items-center gap-2 rounded-xl bg-zinc-100 p-2 dark:bg-zinc-800 ${held ? 'z-10 shadow-xl ring-2 ring-accent' + (drag.settling ? ' transition-transform duration-150' : '') : drag ? 'transition-transform duration-150' : ''}`}>
            {edit?.id === c.id ? (
              <form className="flex min-w-0 flex-1 gap-2" onSubmit={e => { e.preventDefault(); run(renameCategory(c.id, edit.name), () => setEdit(null)) }}>
                <input autoFocus onFocus={e => e.currentTarget.select()} onBlur={() => setEdit(null)} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} onKeyDown={e => e.key === 'Escape' && setEdit(null)} maxLength={50} aria-label="Category name" className={cardInput} />
                <button aria-label="Save" title="Save" onMouseDown={e => e.preventDefault() /* keep focus, or the input's blur cancels before the click lands */} className={primary}><Icon name="check" /></button>
              </form>
            ) : <>
              <button aria-label={`Reorder ${c.name}`} title="Drag to reorder" className={iconBtn + ' cursor-grab touch-none select-none text-zinc-500'}
                onPointerDown={e => {
                  if (drag) return
                  e.currentTarget.setPointerCapture(e.pointerId); setErr('')
                  const li = e.currentTarget.closest('li')!
                  setDrag({ id: c.id, from: i, to: i, y0: e.clientY, dy: 0, step: li.offsetHeight + 8 }) // 8 = the list's space-y-2
                }}
                onPointerMove={e => setDrag(d => {
                  if (!d || d.settling) return d
                  const dy = Math.min(Math.max(e.clientY - d.y0, -d.from * d.step), (cats.length - 1 - d.from) * d.step) // stay inside the list
                  return { ...d, dy, to: Math.round(d.from + dy / d.step) }
                })}
                onPointerUp={() => {
                  if (!drag || drag.settling) return
                  const { from, to, step } = drag
                  setDrag({ ...drag, dy: (to - from) * step, settling: true }) // glide into the slot; the save runs meanwhile, then the order swaps
                  const n = reordered(from, to)
                  const saved = from === to ? Promise.resolve(true) : persist(n)
                  const glide = new Promise(r => setTimeout(r, 150))
                  glide.then(() => { setCats(() => n); setDrag(null) })
                  Promise.all([saved, glide]).then(([ok]) => ok || failed()) // after the swap, so the reload can't be overwritten by it
                }}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={e => {
                  const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                  if (d && i + d >= 0 && i + d < cats.length) { e.preventDefault(); commit(i, i + d) }
                }}><Icon name="grip" className="size-5" /></button>
              <span className="min-w-0 flex-1 break-words px-2 text-sm font-medium">{c.name} <span className="text-xs text-zinc-500">{favs.filter(s => s.cats?.includes(c.id)).length}</span></span>
              <button aria-label={`Rename ${c.name}`} title="Rename" onClick={() => { setEdit(c); setErr('') }} className={iconBtn}><Icon name="edit" className="size-5" /></button>
              <button aria-label={`Delete ${c.name}`} title="Delete" onClick={() => { setDel(c); setErr('') }} className={iconBtn + ' text-red-500'}><Icon name="trash" className="size-5" /></button>
            </>}
          </li>
          )
        })}
      </ul>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) run(addCategory(name), () => setName('')) }}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={50} placeholder="New category" aria-label="New category name" className={input} />
        <button aria-label="Add category" title="Add category" className={primary}><Icon name="add" /></button>
      </form>
      {err && <p role="alert" className="text-sm text-red-500">{err}</p>}
    </Modal>
  )
}

const TABS = [['songs', 'Songs'], ['singers', 'Singers'], ['favorites', 'Favorites'], ['history', 'History'], ['queue', 'Queue']] as const
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
    const h = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-popup]')) return
      if (t.dataset.dim !== undefined) swallowNextClick() // the dimmed backdrop on phones
      setMenu(null)
    }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])
  const [queue, setQueue] = useState<{ items: Song[]; count: number; current: Song | null; pending: Song[]; downloaded: string[] }>({ items: [], count: 0, current: null, pending: [], downloaded: [] })
  const [toast, setToast] = useState<{ text: string; icon?: IconName; tone?: 'accent' | 'cloud' | 'error'; on: boolean }>({ text: '', on: false })
  const toastTimer = useRef<number>(0)

  // Lock page scroll behind a popup on desktop only: on phones a locked body makes the browser bring back its URL bar, so the dim layer (touch-none) blocks scrolling there instead.
  useEffect(() => { document.body.style.overflow = menu && window.matchMedia('(min-width: 768px)').matches ? 'hidden' : '' }, [menu])

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
  const [favList, setFavList] = useState<Song[]>([])
  const [history, setHistory] = useState<Song[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [catFilter, setCatFilter] = useState<CatFilter>('all')
  const [modal, setModal] = useState<{ kind: 'picker'; song: Song } | { kind: 'manage' } | null>(null)
  const pending = useRef<Promise<unknown>>(Promise.resolve()) // the latest favorite add/remove, so a category change can wait for its song to exist
  // Other devices share these lists, so reload whenever the tab changes.
  const reload = useCallback(() => {
    getList('favorites').then(l => Array.isArray(l) && setFavList(l)).catch(() => {})
    getList('history').then(l => Array.isArray(l) && setHistory(l)).catch(() => {})
    getCategories().then(c => Array.isArray(c) && setCats(c)).catch(() => {})
  }, [])
  useEffect(() => { reload() }, [tab, reload])
  const flash = (text: string, tone?: 'error') => {
    setToast({ text, tone, on: true }); clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(t => ({ ...t, on: false })), 2500)
  }
  const favorite = (s: Song) => {
    const prev = favList
    setFavList([...prev, { sONGBM: s.sONGBM, sONGNAME: s.sONGNAME, sINGER: s.sINGER, cats: [] }]) // no cLOUD: not stored, so don't show it
    pending.current = addFavorite(s).catch(() => { setFavList(prev); flash("Couldn't save favorite", 'error') })
  }
  const unfavorite = (bm: string) => {
    const prev = favList
    setFavList(prev.filter(f => f.sONGBM !== bm))
    pending.current = removeFavorite(bm).catch(() => { setFavList(prev); flash("Couldn't remove favorite", 'error') })
  }
  const setCat = (song: Song, id: number, on: boolean) => {
    const bm = song.sONGBM!
    const prev = favList
    if (!favList.some(f => f.sONGBM === bm)) favorite(song) // picking a category favorites the song
    setFavList(l => l.map(f => f.sONGBM !== bm ? f : { ...f, cats: on ? [...(f.cats ?? []), id] : (f.cats ?? []).filter(c => c !== id) }))
    pending.current.then(() => setSongCategory(bm, id, on)).catch(() => { setFavList(prev); flash("Couldn't save category", 'error') })
  }
  const isCloud = (s: Song) => String(s.cLOUD) === '1'
  const favs: Favs = {
    has: s => favList.some(f => f.sONGBM === s.sONGBM),
    // cloud songs lose their cloud flag once stored (it goes stale), so they can't be favorited yet; an existing favorite can still be managed
    open: s => favs.has(s) || !isCloud(s) ? setModal({ kind: 'picker', song: s }) : flash("Cloud songs can't be favorited yet"),
    add: s => {
      if (favs.has(s)) return false
      if (isCloud(s)) { flash("Cloud songs can't be favorited yet"); return false }
      favorite(s); return true
    },
  }
  const filterable = tab === 'songs' || tab === 'singers' || tab === 'favorites' // history only gets text search
  const catSel = catFilter === 'none' || cats.some(c => c.id === catFilter) ? catFilter : 'all' // a deleted category falls back to All
  const activeLabel = tab === 'songs' ? (filter.singer ? filter.singer : filterName(filter))
    : tab === 'favorites' ? (catSel === 'all' ? undefined : catSel === 'none' ? 'Uncategorized' : cats.find(c => c.id === catSel)?.name)
    : area > 0 ? AREAS[area] : undefined
  const shownFavs = catSel === 'all' ? favList : favList.filter(s => (catSel === 'none' ? !s.cats?.length : s.cats?.includes(catSel)))
  const record = (s: Song) => { // newest first, one entry per song; the server does the same and caps at 100
    setHistory(h => [s, ...h.filter(x => x.sONGBM !== s.sONGBM)].slice(0, 100))
    recordHistory(s).catch(() => {})
  }
  const total = queue.items.length
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [refresh])

  const act: Act = (action, val = '', label, icon, song) => {
    const show = (text: string, i?: IconName, tone?: 'error') => {
      // Pill mirrors the pressed button: Add is accent-filled, everything else neutral.
      setToast({ text, icon: i, tone: tone ?? (i === 'cloud' ? 'cloud' : action === 'add-song' ? 'accent' : undefined), on: true })
      clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(t => ({ ...t, on: false })), longPopups ? 4500 : 2500)
    }
    command(action, val, song).then(() => { show(label ?? REMOTE_LABELS[action] ?? action, icon); if (song) record(song); refresh() }).catch(() => { show("Not sent · can't reach the KTV machine", undefined, 'error'); refresh() })
  }

  const cloudIds = useMemo(() => ({ pending: new Set(queue.pending.map(p => String(p.sONGBM))), downloaded: new Set(queue.downloaded) }), [queue.pending, queue.downloaded])
  const item = (on: boolean, extra = '') => `flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] transition duration-150 active:scale-95 md:flex-none md:flex-row md:gap-2 md:px-4 md:text-sm ${on ? 'bg-accent/15 font-bold text-accent' : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'} ${extra}`
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
    <CloudCtx.Provider value={cloudIds}>
    <div className="mx-auto min-h-dvh max-w-7xl pb-28 md:pb-6">
      {menu && <div data-dim className="animate-fade pointer-events-none fixed inset-0 z-[15] bg-black/40 max-md:pointer-events-auto max-md:touch-none md:z-[5]" />}
      <header className={`sticky top-0 z-10 flex items-center gap-3 p-3 ${opaqueBars ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-zinc-50/90 backdrop-blur dark:bg-zinc-950/90'}`}>
        <h1 className="hidden text-lg font-bold text-accent sm:block">KTV</h1>
        {tabs('hidden md:flex md:gap-2')}
        {tab !== 'queue' &&
          <div className="min-w-0 flex-1" data-popup>
            <div className="relative">
            <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder={`Search ${tab}…`}
              className={`w-full rounded-xl bg-zinc-200 py-3 pl-4 ${filterable ? 'pr-40' : 'pr-4'} outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800`} />
            {filterable && <button aria-label="Filters" onClick={() => setMenu(menu === 'filter' ? null : 'filter')}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition duration-150 hover:brightness-110 active:scale-95 after:content-['▾'] ${activeLabel ? 'bg-accent text-white' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
                <span className="block max-w-28 truncate">{activeLabel ?? 'Filter'}</span>
              </button>}
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
        <main className="min-w-0 flex-1 pt-2">
          {tab === 'songs' && <Songs q={q} act={act} filter={filter} epoch={epoch} favs={favs} />}
          {tab === 'favorites' && <SavedList name="favorites" items={shownFavs} q={q} act={act} favs={favs} empty={favList.length ? 'No songs in this category.' : 'No favorites yet. Double-tap a song to save it.'} />}
          {tab === 'history' && <SavedList name="history" items={history} q={q} act={act} favs={favs} empty="Nothing requested yet."/>}
          {tab === 'singers' && <Singers epoch={epoch} q={q} area={area} onPick={name => { setFilter({ singer: name }); setQ(''); setTab('songs') }} />}
          {tab === 'queue' && <Queue items={queue.items} pending={queue.pending} current={queue.current} act={act} />}
        </main>
        <aside className="sticky top-[4.5rem] -mx-1 hidden h-[calc(100dvh-6rem)] w-96 shrink-0 overflow-y-auto px-1 pt-2 lg:block">
          <Queue items={queue.items} pending={queue.pending} current={queue.current} act={act} />
        </aside>
      </div>

      {tabs('fixed inset-x-3 bottom-3 z-10 flex gap-1 rounded-2xl border border-zinc-200/70 p-1.5 shadow-xl shadow-black/10 dark:border-zinc-700/60 md:hidden ' + (opaqueBars ? 'bg-white dark:bg-zinc-900' : 'bg-white/85 backdrop-blur dark:bg-zinc-900/85'))}
      {/* md+: same width/centering as the page container so popups line up with the header. Phones: popups are flex children above the toolbar, like Modal */}
      <div className="pointer-events-none fixed inset-0 z-20 mx-auto max-w-7xl max-md:flex max-md:items-end max-md:justify-center max-md:p-3 max-md:pb-[5.5rem]">
      {menu === 'filter' && <FilterPanel tab={tab} filter={filter} setFilter={setFilter} area={area} setArea={setArea} cats={cats} catFilter={catSel} setCatFilter={setCatFilter} close={() => setMenu(null)} />}
      {menu === 'theme' && <SettingsPanel t={theme} onManage={() => { setMenu(null); setModal({ kind: 'manage' }) }} />}
      {menu === 'remote' && (
        <div data-popup className="animate-pop pointer-events-auto max-h-full w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10 md:absolute md:right-3 md:top-[4.75rem] md:max-h-[calc(100dvh-6rem)] md:w-96">
          <Remote act={act} />
        </div>
      )}
      </div>
      {modal?.kind === 'picker' && (() => {
        const song = modal.song, fav = favList.find(f => f.sONGBM === song.sONGBM)
        return <CategoryPicker song={song} fav={fav} cats={cats} setCat={(id, on) => setCat(song, id, on)} toggle={() => fav ? unfavorite(song.sONGBM!) : favorite(song)} onEdit={() => setModal({ kind: 'manage' })} onClose={() => setModal(null)} />
      })()}
      {modal?.kind === 'manage' && <ManageCategories cats={cats} setCats={setCats} favs={favList} reload={reload} onClose={() => setModal(null)} />}
      <div className={`pointer-events-none fixed left-1/2 top-20 z-30 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full px-5 py-2 shadow-lg transition-all duration-300 ${toast.tone === 'error' ? 'bg-red-500 text-white' : toast.tone === 'cloud' ? 'bg-sky-500 text-white' : toast.tone === 'accent' ? 'bg-accent text-white' : 'bg-zinc-200 text-zinc-900 ring-1 ring-black/10 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10'} ${toast.on ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}>
        {toast.icon && <Icon name={toast.icon} className="size-4 shrink-0" />}<span className="truncate">{toast.text}</span>
      </div>
    </div>
    </CloudCtx.Provider>
  )
}
