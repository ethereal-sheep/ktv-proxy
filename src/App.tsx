import useEmblaCarousel from 'embla-carousel-react'
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clearList, addCategory, addFavorite, command, deleteCategory, getCategories, getHost, getList, getQr, getQueue, searchList, type ListName, type Origin, removeFavorite, renameCategory, reorderCategories, setSongCategory, scanNetwork, serverId, setHost, setQr, searchSingers, searchSongs, singerImg, type Category, type DeleteSongs, type Filter, type Singer, type Song } from './api'
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

// Holds the last value seen while active, so a hidden (but mounted) tab keeps its cached list instead of requerying.
function useFrozen<T>(v: T, active: boolean) { const r = useRef(v); if (active) r.current = v; return r.current }

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

type Act = (action: string, val?: string, label?: string, icon?: IconName, song?: Song, origin?: Origin) => void
const from = (act: Act, origin: Origin): Act => (a, v, l, i, s) => act(a, v, l, i, s, origin) // tags song requests with the tab they came from
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
const CloudCtx = createContext({ pending: new Set<string>(), downloaded: new Set<string>(), queued: new Map<string, number>() })

function SongRow({ s, act, queue, favs, downloading, first }: { s: Song; act: Act; queue?: boolean; favs?: Favs; downloading?: boolean; first?: boolean }) {
  const { helperLabels } = useContext(SettingsCtx)
  const lbl = (t: string) => helperLabels && <span className="text-[10px] font-normal leading-none">{t}</span>
  const col = ' flex flex-col items-center gap-1'
  const { pending, downloaded, queued } = useContext(CloudCtx)
  const inQueue = queued.get(String(s.sONGBM)) ?? 0
  const cloud = String(s.cLOUD) === '1' && (downloading || !queue) && !downloaded.has(String(s.sONGBM)) // the flag stays 1 after the download
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null) // where the double tap landed; plays the heart animation
  const g = useRowGesture(() => favs?.open(s), (x, y) => { if (favs?.add(s)) setPop({ x, y }) })
  const liked = !queue && !!favs?.has(s)
  const singers = s.sINGER.split(/\s*,\s*/).filter(Boolean) // the box joins co-singers with a bare comma; wrap between singers, not inside a name
  return (
    <li {...(queue || !favs ? {} : g.handlers)} tabIndex={queue || !favs ? undefined : 0} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && favs?.open(s)}
      className={`relative flex touch-manipulation select-none items-center gap-3 rounded-xl bg-white p-3 shadow-sm transition-[box-shadow,background-color] hover:shadow-md dark:bg-zinc-900 ${g.holding ? 'bg-accent/5 ring-2 ring-accent/40 duration-300' : 'duration-150'} ${downloading ? 'opacity-60' : ''}`}>
      {(liked || cloud || (inQueue > 0 && !queue)) && <span className="heart-badge absolute -left-1 -top-2 z-[1] flex items-center gap-1 drop-shadow">
        <span className="w-5 shrink-0">{liked ? <Icon name="favorites" className={`size-5 fill-current text-pink-500 ${pop ? 'animate-heart-pop' : ''}`} /> : cloud && <span title="Cloud song: downloads when requested" className="text-sky-500"><Icon name="cloud" className="size-5 fill-current" /></span>}</span> {/* heart and cloud never co-occur, so they share one slot; Queued sits in the same spot whatever else is shown */}
        {inQueue > 0 && !queue && <span title={`In queue${inQueue > 1 ? ` ×${inQueue}` : ''}`} className="flex h-5 items-center rounded-full bg-amber-500 px-2 text-[9px] font-semibold uppercase leading-none tracking-wide text-white dark:bg-amber-400 dark:text-zinc-900">Queued{inQueue > 1 && ` ×${inQueue}`}</span>}
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
        <button disabled={pending.has(String(s.sONGBM))} className="flex flex-col items-center gap-1 rounded-xl bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-600 transition duration-150 hover:-translate-y-0.5 hover:bg-sky-500/25 hover:shadow-md active:translate-y-0 dark:text-sky-400 active:scale-90 disabled:pointer-events-none disabled:opacity-40" title="Request download" onClick={() => act('add-song', s.sONGBM, `Cloud request sent · queued · ${s.sONGNAME}`, 'cloud', s)}><Icon name="download" className="size-5 [stroke-width:3]" />{lbl('Req')}</button>
      ) : <>
        <button className={'rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-200 active:bg-accent active:text-white dark:bg-zinc-800 dark:text-inherit dark:hover:bg-zinc-700 transition duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-90' + col} title="Play next" onClick={() => act('play-song-next', s.sONGBM, `Playing next · ${s.sONGNAME}`, 'next', s)}><Icon name="next" />{lbl('Next')}</button>
        <button className="rounded-xl bg-accent/15 px-4 py-3 text-sm font-semibold text-accent flex flex-col items-center gap-1 transition duration-150 hover:-translate-y-0.5 hover:bg-accent/25 hover:shadow-md active:translate-y-0 active:scale-90" title="Add to queue" onClick={() => act('add-song', s.sONGBM, `Added · ${s.sONGNAME}`, 'add', s)}><Icon name="add" className="size-5 [stroke-width:3]" />{lbl('Add')}</button>
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
        <h1><Logo size={32} text={39} /></h1>
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

function SavedList({ name, items, q, cat, act, favs, empty, narrow }: { name: ListName; items: Song[]; q: string; cat?: CatFilter; act: Act; favs: Favs; empty: string; narrow?: boolean }) {
  const n = q.trim().toLowerCase()
  // the server matches (incl. pinyin); until it answers, or if it can't, fall back to plain text
  const [hits, setHits] = useState<{ ids: Set<string> } | null>(null) // kept while typing, so the list doesn't blank between keystrokes
  useEffect(() => {
    if (!n && (cat === undefined || cat === 'all')) { setHits(null); return }
    const t = setTimeout(() => searchList(name, n, cat === 'all' ? undefined : cat).then(l => Array.isArray(l) && setHits({ ids: new Set(l.map(s => s.sONGBM!)) })).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [name, n, cat])
  if (!items.length) return <p className="p-6 text-center text-zinc-500">{empty}</p>
  if (hits) items = items.filter(s => hits.ids.has(s.sONGBM!)) // no answer yet: keep showing the unfiltered list rather than a blank
  if (!items.length) return <p className="p-6 text-center text-zinc-500">Nothing found.</p>
  return <ul className={`grid gap-2 ${narrow ? '' : 'xl:grid-cols-2'}`}>{items.map(s => <SongRow key={s.sONGBM} s={s} act={act} favs={favs} />)}</ul>
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

// Labels for the toast shown after each remote action.
const REMOTE_LABELS: Record<string, string> = {
  'toggle-vocal': 'Switched Original / Karaoke', replay: 'Replaying', 'play-pause': 'Play / Pause sent', skip: 'Skipped', mute: 'Mute toggled',
  'music-volume-up': 'Music volume up', 'music-volume-down': 'Music volume down', 'music-key-up': 'Key up', 'music-key-down': 'Key down',
  'mic-volume-up': 'Mic volume up', 'mic-volume-down': 'Mic volume down', 'mic-echo-up': 'Echo up', 'mic-echo-down': 'Echo down',
  'mic-reverb-up': 'Reverb up', 'mic-reverb-down': 'Reverb down',
}
const PLAYER_CONTROLS: [string, string, IconName, boolean?][] = [['Original / Karaoke', 'toggle-vocal', 'karaoke'], ['Replay', 'replay', 'restart', true], ['Play / Pause', 'play-pause', 'play', true], ['Skip', 'skip', 'skip', true]]
const ctl = 'flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-xl bg-white/80 px-2 text-sm text-accent shadow-sm transition duration-150 hover:bg-white hover:shadow-md active:scale-90 active:bg-accent active:text-white dark:bg-zinc-900/70 dark:hover:bg-zinc-900 disabled:pointer-events-none disabled:bg-zinc-300/40 disabled:text-zinc-400 disabled:shadow-none dark:disabled:bg-zinc-700/30 dark:disabled:text-zinc-600'

// The vinyl: spins while a song plays.
// The app mark: a round record in the accent colour (the same disc as the queue button) with a highlight arc, then a right-leaning wordmark sized separately from the disc.
function Logo({ size = 24, text = 28 }: { size?: number; text?: number }) {
  return (
    <span className="flex select-none items-center gap-2 text-accent">
      <svg aria-hidden width={size} height={size} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" fill="currentColor" /><circle cx="16" cy="16" r="10" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" /><circle cx="16" cy="16" r="3.5" fill="#fff" /><path d="M22.5 5a13 13 0 0 1 5 5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
      <span style={{ fontSize: text, lineHeight: 1 }} className="inline-block -skew-x-12 font-black italic tracking-tighter">KTV</span>
    </span>
  )
}

function Disc({ spin, className }: { spin: boolean; className: string }) {
  return (
    <div aria-hidden className={`relative shrink-0 rounded-full ${spin ? 'animate-spin bg-zinc-900 dark:bg-zinc-950' : 'bg-zinc-400 dark:bg-zinc-700'} ${className}`} style={spin ? { animationDuration: '3s' } : undefined}>
      <div className="absolute inset-[10%] rounded-full border border-white/10" />
      <div className="absolute inset-[21%] rounded-full border border-white/10" />
      <div className={`absolute inset-[32%] rounded-full ${spin ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-500'}`} />
      <div className="absolute left-1/2 top-1/2 size-[10%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      <div className="absolute left-[10%] top-1/2 h-0.5 w-[14%] -translate-y-1/2 rounded bg-white/30" />
    </div>
  )
}

function NowPlaying({ current, act }: { current: Song | null; act: Act }) {
  const { playerControls, showMusic, showMic } = useContext(SettingsCtx)
  const pair = (label: string, down: string, up: string) => (
    <div key={label} className="flex min-w-32 flex-1 items-center gap-1 rounded-xl bg-white/80 shadow-sm dark:bg-zinc-900/70">
      <button aria-label={`${label} down`} className="min-h-11 min-w-11 flex-1 rounded-l-xl text-accent transition active:scale-90 active:bg-accent active:text-white" onClick={() => act(down)}>−</button>
      <span className="text-xs text-zinc-500">{label}</span>
      <button aria-label={`${label} up`} className="min-h-11 min-w-11 flex-1 rounded-r-xl text-accent transition active:scale-90 active:bg-accent active:text-white" onClick={() => act(up)}>+</button>
    </div>
  )
  return (
    <div className={`mb-2 rounded-xl px-4 py-3 transition-colors ${current ? 'bg-accent/15' : 'bg-zinc-200/60 dark:bg-zinc-800/60'}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wide text-accent`}>Now playing</div>
          {current
            ? <><div className="break-words font-medium leading-snug">{current.sONGNAME}</div><div className="break-words text-zinc-500">{current.sINGER}</div></>
            : <><div className="font-medium leading-snug text-zinc-400">Nothing playing right now</div><div className="text-zinc-400">-</div></>}
        </div>
        <Disc spin={!!current} className="size-14" />
      </div>
      {playerControls && <div className="mt-3 flex gap-2">
        {PLAYER_CONTROLS.map(([label, c, icon, solid]) => (
          <button key={c} disabled={!current} className={ctl} title={label} aria-label={label} onClick={() => act(c)}>{c === 'toggle-vocal' ? <><SolidMic /><span className="mx-2 h-4 w-px bg-current opacity-30" /><SolidMic off /></> : <Icon name={icon} className={`size-4 ${solid ? 'fill-current' : ''}`} />}</button>
        ))}
      </div>}
      {showMusic && <div className="mt-2 flex gap-2">
        <button className={ctl} onClick={() => act('music-volume-down')}>Vol −</button>
        <button className={ctl} onClick={() => act('music-volume-up')}>Vol +</button>
        <button className={ctl} aria-label="Mute" title="Mute" onClick={() => act('mute')}><Icon name="mute" className="size-4" /></button>
        <button className={ctl} aria-label="Key down" onClick={() => act('music-key-down')}>♭</button>
        <button className={ctl} aria-label="Key up" onClick={() => act('music-key-up')}>♯</button>
      </div>}
      {showMic && <div className="mt-2 flex flex-wrap gap-2">
        {pair('Mic', 'mic-volume-down', 'mic-volume-up')}{pair('Echo', 'mic-echo-down', 'mic-echo-up')}{pair('Reverb', 'mic-reverb-down', 'mic-reverb-up')}
      </div>}
    </div>
  )
}

type QView = 'queue' | 'history'
const QVIEWS: QView[] = ['queue', 'history']
// The now-playing card stays pinned; Queue and History are two swipeable panes that scroll on their own.
// The queue column on desktop and the popup on smaller screens are both this.
function QueuePanel({ view, setView, queue, history, act, favs }: { view: QView; setView: (v: QView) => void; queue: { items: Song[]; pending: Song[]; current: Song | null }; history: Song[]; act: Act; favs: Favs }) {
  // Embla does the swiping: it locks the axis on the first moves, so a vertical scroll in a list never fights the horizontal drag.
  const [viewport, embla] = useEmblaCarousel({ startIndex: QVIEWS.indexOf(view), duration: 22 })
  const root = useRef<HTMLDivElement>(null)
  // Painted straight on the DOM from Embla's per-frame scroll event (--p = 0..1 swipe progress; data-on marks the nearest pane); React state only changes once the swipe has settled.
  useEffect(() => {
    if (!embla) return
    const paint = () => {
      const p = embla.scrollProgress() * (QVIEWS.length - 1), el = root.current
      if (!el) return
      el.style.setProperty('--p', String(p))
      el.querySelectorAll<HTMLElement>('[data-i]').forEach(n => { n.dataset.on = String(Math.abs(p - +n.dataset.i!) < 0.5) })
    }
    const settled = () => setView(QVIEWS[embla.selectedScrollSnap()])
    paint(); embla.on('scroll', paint).on('reInit', paint).on('settle', settled)
    return () => { embla.off('scroll', paint).off('reInit', paint).off('settle', settled) }
  }, [embla, setView])
  const pane = `h-full min-w-0 flex-[0_0_100%] overflow-y-auto overscroll-y-contain px-1 pt-2.5` // the padding leaves room for the heart badge that overhangs each row
  const tab = (v: QView, i: number, cls: string) => <button key={v} data-i={i} role="tab" aria-selected={view === v} onClick={() => embla?.scrollTo(i)} className={`capitalize ${cls}`}>{v}</button>
  const thumb = 'absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-accent [transform:translateX(calc(var(--p)*100%))]'
  const seg = (cls: string) => <div role="tablist" className={`relative flex ${cls}`}><span className={thumb} />{QVIEWS.map((v, i) => tab(v, i, 'relative z-10 flex-1 text-xs font-semibold text-zinc-600 transition-colors data-[on=true]:text-white dark:text-zinc-300'))}</div>
  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      <NowPlaying current={queue.current} act={act} />
      {seg('h-8 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800')}
      <div className="min-h-0 flex-1">
        <div ref={viewport} className="h-full overflow-hidden">
          <div className="flex h-full touch-pan-y touch-pinch-zoom">
            <div className={pane}>
              <ul className="grid gap-2">
                {queue.items.map((s, i) => <SongRow key={s.xH} s={s} act={act} queue first={i === 0} />)}
                {queue.pending.map((s, i) => <SongRow key={'dl' + i} s={s} act={act} queue downloading />)}
              </ul>
            </div>
            <div className={pane}><SavedList name="history" items={history} q="" act={from(act, 'history')} favs={favs} empty="" narrow /></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Phones: a full-width headline ticker, Now playing then Up next, scrolling right to left. Tap opens the queue. Motion-reduced: a still line.
function NowBanner({ current, next, onOpen }: { current: Song | null; next?: Song; onOpen: () => void }) {
  const { bannerSpeed } = useContext(SettingsCtx)
  const line = (label: string, s: Song | null | undefined, now?: boolean) => <span className={`inline-flex items-center ${now ? '' : 'opacity-75'} ${!s && label === 'Not Playing' ? 'text-zinc-300' : ''}`}><b className={`mr-2.5 rounded-sm px-1.5 py-0.5 leading-none text-[10px] font-bold uppercase tracking-[0.18em] ${now ? 'bg-white text-[color-mix(in_srgb,var(--accent)_100%,black)]' : label === 'Not Playing' ? 'bg-white text-zinc-500' : 'border border-white/60'}`}>{label}</b><span className={now ? 'font-bold' : 'font-normal'}>{s ? s.sONGNAME : label === 'Not Playing' ? 'Anything' : 'Nothing'}</span>{s && <><span aria-hidden className="mx-2.5 h-3 w-px bg-white/50" /><span className="text-white/70">{s.sINGER}</span></>}</span>
  const parts = [line(current ? 'Now playing' : 'Not Playing', current, !!current), line('Up next', next)]
  const chars = (current ? current.sONGNAME.length + current.sINGER.length : 0) + (next ? next.sONGNAME.length + next.sINGER.length : 0)
  const text = <span className="inline-flex min-w-[100vw] shrink-0 items-center gap-8 pr-8">{parts.map((p, i) => <Fragment key={i}><span>{p}</span><span aria-hidden className="size-1.5 rotate-45 bg-white/50" /></Fragment>)}</span>
  return (
    <button data-popup onClick={onOpen} aria-label="Now playing and up next. Open queue" className={`block h-9 w-full overflow-hidden font-mono text-sm text-white shadow-md shadow-black/20 ${current ? 'bg-[color-mix(in_srgb,var(--accent)_62%,black)]' : 'bg-zinc-500'}`}>
      <div className="flex h-full w-max animate-marquee items-center whitespace-nowrap" style={{ ['--d' as string]: `${Math.max(390, chars * 9 + 160) / bannerSpeed}s` }}>
        {text}<span aria-hidden>{text}</span>
      </div>
    </button>
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

function SettingsMenu({ open, onClick }: { open: boolean; onClick: () => void }) {
  return <button className={`${btn} ${open ? '!bg-accent text-white' : ''}`} aria-label="Settings" aria-pressed={open} onClick={onClick}><Icon name="settings" /></button>
}

const H = 'text-xs font-semibold uppercase tracking-wide text-zinc-500'
const section = 'space-y-2 rounded-2xl bg-white p-4 ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10'

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-x-4 text-sm"><dt className="text-zinc-500">{label}</dt><dd className="min-w-0 break-all text-right tabular-nums">{value}</dd></div>
}

function ClearRow({ label, count, onClear }: { label: string; count: number; onClear: () => Promise<unknown> }) {
  const [ask, setAsk] = useState(false)
  const [err, setErr] = useState('')
  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label} <span className="tabular-nums text-zinc-500">· {count}</span></span>
        <button disabled={!count} onClick={() => setAsk(true)} className="min-h-11 rounded-lg bg-red-500/10 px-3 text-red-600 transition active:scale-95 disabled:opacity-40 dark:text-red-400">Clear</button>
      </div>
      {ask && (
        <Modal title={`Clear ${label.toLowerCase()}?`} subtitle={`${nSongs(count)} will be removed for everyone using this server. This can't be undone.`} onClose={() => { setAsk(false); setErr('') }}>
          {err && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setAsk(false); setErr('') }} className="min-h-11 flex-1 rounded-lg bg-zinc-200 dark:bg-zinc-800">Cancel</button>
            <button onClick={() => onClear().then(() => setAsk(false)).catch(e => setErr(e.message))} className="min-h-11 flex-1 rounded-lg bg-red-600 font-medium text-white">Clear</button>
          </div>
        </Modal>
      )}
    </>
  )
}

// The box's QR opens its own page; a router port-forward to the shim (see server/shim.ts) sends phones here instead, or to this URL.
function QrSection() {
  const [saved, setSaved] = useState<string | null>(null) // null = not loaded yet
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; text: string } | 'busy' | null>(null)
  const test = () => {
    setCheck('busy')
    Promise.all([serverId(), serverId(url.trim())]).then(
      ([me, them]) => setCheck(me === them ? { ok: true, text: 'Reaches this server' } : { ok: false, text: 'Reaches a different KTV server' }),
      () => setCheck({ ok: false, text: "Couldn't reach this server at that URL" }), // CORS, DNS, cert or not a KTV server: the browser doesn't say which
    )
  }
  useEffect(() => { getQr().then(u => { setSaved(u); setUrl(u) }).catch(() => {}) }, [])
  const save = () => {
    setBusy(true); setErr('')
    setQr(url).then(u => { setSaved(u); setUrl(u) }).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }
  return (
    <section className={section}>
      <h4 className={H}>QR code</h4>
      <p className="text-sm text-zinc-500">Where scanning the box's QR code takes phones. Leave empty for this server's own address. Needs the router port-forward described in the README.</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); save() }}>
        <input value={url} onChange={e => { setUrl(e.target.value); setCheck(null) }} type="url" inputMode="url" placeholder="https://ktv.example.com" aria-label="QR redirect URL" disabled={saved === null}
          className="min-h-11 min-w-0 flex-1 rounded-lg bg-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800" />
        <button type="button" onClick={test} disabled={!url.trim() || check === 'busy'} className="min-h-11 rounded-lg bg-zinc-200 px-4 text-sm transition hover:bg-zinc-300 active:scale-95 disabled:opacity-40 dark:bg-zinc-800 dark:hover:bg-zinc-700">{check === 'busy' ? 'Testing…' : 'Test'}</button>
        <button disabled={busy || saved === null || url.trim() === saved} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white transition active:scale-95 disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
      </form>
      {check && check !== 'busy' && <p role="status" className={`text-sm ${check.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{check.text}</p>}
      {err && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </section>
  )
}

function SettingsPage({ t, online, host, favs, history, cats, onManage, reload }: { t: ReturnType<typeof useTheme>; online: boolean | null; host: string | null | undefined; favs: number; history: number; cats: number; onManage: () => void; reload: () => void }) {
  const st = useContext(SettingsCtx) as ReturnType<typeof useSettingsState>
  const status = online === true ? ['Connected', 'text-green-600 dark:text-green-400'] : online === false ? ["Can't reach the box", 'text-red-600 dark:text-red-400'] : ['Checking…', 'text-zinc-500']
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-4">
      <h2 className="text-xl font-bold">Settings</h2>
      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <div className="space-y-3">
          <div><h3 className="font-semibold">This device</h3><p className="text-sm text-zinc-500">Saved on this phone only.</p></div>
          <section className={section}>
            <h4 className={H}>Appearance</h4>
            <div className="flex gap-1">
              {(['system', 'light', 'dark'] as Mode[]).map(m => (
                <button key={m} onClick={() => t.setMode(m)} className={`min-h-11 flex-1 rounded-lg text-sm capitalize transition active:scale-95 ${t.mode === m ? 'bg-accent text-white hover:brightness-110' : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{m}</button>
              ))}
            </div>
            <div className="flex justify-between py-1">
              {Object.entries(ACCENTS).map(([name, hex]) => (
                <button key={name} aria-label={name} onClick={() => t.setAccent(name as keyof typeof ACCENTS)}
                  style={{ background: hex }} className={`size-11 rounded-full transition duration-150 hover:scale-105 active:scale-90 ${t.accent === name ? 'ring-2 ring-offset-2 ring-zinc-500 dark:ring-offset-zinc-900' : ''}`} />
              ))}
            </div>
          </section>
          <section className={section}>
            <h4 className={H}>Display</h4>
            <Toggle label="Opaque toolbars" on={st.opaqueBars} onClick={() => st.toggle('opaqueBars')} />
            <Toggle label="SVG icons" on={st.svgIcons} onClick={() => st.toggle('svgIcons')} />
            <Toggle label="Helper labels" on={st.helperLabels} onClick={() => st.toggle('helperLabels')} />
            <Toggle label="Hide secondary names" on={st.hideAltNames} onClick={() => st.toggle('hideAltNames')} />
            <Toggle label="Longer popups" on={st.longPopups} onClick={() => st.toggle('longPopups')} />
          </section>
          <section className={`${section} lg:hidden`}>
            <h4 className={H}>Now playing banner</h4>
            <Toggle label="Show banner" on={st.bannerOn} onClick={() => st.toggle('bannerOn')} />
            {st.bannerOn && <>
              <div className="flex gap-1 pt-1">
                {([['top', 'Screen top'], ['toolbar', 'Above toolbar']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => st.setBanner(v)} className={`min-h-11 flex-1 rounded-lg px-1 text-sm transition active:scale-95 ${st.banner === v ? 'bg-accent text-white' : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700'}`}>{l}</button>
                ))}
              </div>
              <label className="flex items-center gap-3 px-1 pt-2 text-sm">Speed
                <input type="range" min={30} max={200} step={10} value={st.bannerSpeed} onChange={e => st.setBannerSpeed(+e.target.value)} className="h-11 flex-1 accent-accent" />
              </label>
            </>}
          </section>
          <section className={section}>
            <h4 className={H}>Remote</h4>
            <Toggle label="Playback controls" on={st.playerControls} onClick={() => st.toggle('playerControls')} />
            <Toggle label="Music controls" on={st.showMusic} onClick={() => st.toggle('showMusic')} />
            <Toggle label="Mic controls" on={st.showMic} onClick={() => st.toggle('showMic')} />
          </section>
        </div>
        <div className="space-y-3">
          <div><h3 className="font-semibold">This server</h3><p className="text-sm text-zinc-500">Shared by everyone using this remote.</p></div>
          <section className={section}>
            <h4 className={H}>Box</h4>
            <dl className="space-y-1">
              <Fact label="Address" value={host ?? 'Not set'} />
              <Fact label="Status" value={<span className={status[1]}>{status[0]}</span>} />
            </dl>
            <a href="/api/docs" className="flex min-h-11 items-center text-sm text-accent hover:underline">API docs</a>
          </section>
          <QrSection />
          <section className={section}>
            <h4 className={H}>Favorites</h4>
            <button onClick={onManage} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"><Icon name="tag" className="size-4" />Manage categories <span className="tabular-nums text-zinc-500">· {cats}</span></button>
          </section>
          <section className={section}>
            <h4 className={H}>Data</h4>
            <ClearRow label="History" count={history} onClear={() => clearList('history').then(reload)} />
            <ClearRow label="Favorites" count={favs} onClear={() => clearList('favorites').then(reload)} />
          </section>
        </div>
      </div>
    </div>
  )
}

// A tap that closes a popup by its backdrop must not also click whatever sits under it (the close happens on pointerdown, the click comes after).
const swallowNextClick = () => {
  const stop = (e: Event) => e.stopPropagation()
  window.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', stop, true), 400) // no click followed (e.g. a scroll), so don't eat a later one
}

// Fit the visual viewport, not the layout one: a collapsing mobile URL bar or the on-screen keyboard resizes only the latter, which makes fixed panels jump while scrolling.
function useVisualViewport() {
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const f = () => setVv({ top: v.offsetTop, height: v.height })
    f(); v.addEventListener('resize', f); v.addEventListener('scroll', f)
    return () => { v.removeEventListener('resize', f); v.removeEventListener('scroll', f) }
  }, [])
  return vv
}

const LG = '(min-width: 1024px)' // wide enough for the queue column; below it the queue is a popup
function useLg() {
  const [m, setM] = useState(() => window.matchMedia(LG).matches)
  useEffect(() => { const q = window.matchMedia(LG), f = () => setM(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f) }, [])
  return m
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const vv = useVisualViewport()
  return (
    <div style={vv ? { top: vv.top, height: vv.height, bottom: 'auto' } : undefined} data-popup className={`fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3`} onPointerDown={e => { if (e.target === e.currentTarget) { swallowNextClick(); onClose() } }}>
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

const TABS = [['songs', 'Songs'], ['singers', 'Singers'], ['favorites', 'Favorites']] as const
type Tab = (typeof TABS)[number][0]

export default function Root() {
  const st = useSettingsState()
  return <SettingsCtx.Provider value={st}><App /></SettingsCtx.Provider>
}

function App() {
  const theme = useTheme() // must live here: it applies dark mode/accent to the page, so it has to stay mounted
  const { opaqueBars, longPopups, bannerOn, banner } = useContext(SettingsCtx)
  const [tab, setTab] = useState<Tab>('songs')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>({})
  const [area, setArea] = useState(0)
  const [menu, setMenu] = useState<'filter' | 'queue' | null>(null)
  const [qView, setQView] = useState<QView>('queue')
  const [settings, setSettings] = useState(false)
  useEffect(() => { if (!settings) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && setSettings(false); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [settings])
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
  useEffect(() => { document.body.style.overflow = menu && menu !== 'queue' && window.matchMedia('(min-width: 768px)').matches ? 'hidden' : '' }, [menu])

  // null = first poll pending. Poll results double as the server health check; the last good queue is kept while down.
  const [online, setOnline] = useState<boolean | null>(null)
  const [epoch, setEpoch] = useState(0) // bumps when the box comes back after an outage, so failed searches reload
  const wasDown = useRef(false)
  const [fails, setFails] = useState(0) // consecutive failed polls; a few in a row means a real outage, not a blip
  const [cfgHost, setCfgHost] = useState<string | null | undefined>(undefined) // undefined = not loaded yet
  useEffect(() => { getHost().then(setCfgHost).catch(() => setCfgHost(undefined)) }, [])
  const refresh = useCallback(() => getQueue().then(q => {
    setQueue(prev => JSON.stringify(prev) === JSON.stringify(q) ? prev : q); setOnline(true); setFails(0) // an unchanged poll must not re-render the lists mid-swipe
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
  // Songs and singers stay mounted (hidden) so their lists are cached across tab switches.
  const sq = useFrozen(q, tab === 'songs'), sf = useFrozen(filter, tab === 'songs')
  const gq = useFrozen(q, tab === 'singers'), ga = useFrozen(area, tab === 'singers')
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
    const catSel = catFilter === 'none' || cats.some(c => c.id === catFilter) ? catFilter : 'all' // a deleted category falls back to All
  const activeLabel = tab === 'songs' ? (filter.singer ? filter.singer : filterName(filter))
    : tab === 'favorites' ? (catSel === 'all' ? undefined : catSel === 'none' ? 'Uncategorized' : cats.find(c => c.id === catSel)?.name)
    : area > 0 ? AREAS[area] : undefined
  const shownFavs = catSel === 'all' ? favList : favList.filter(s => (catSel === 'none' ? !s.cats?.length : s.cats?.includes(catSel)))
  const record = (s: Song) => { // newest first, one entry per song; the server records it on the request and does the same, capped at 100
    setHistory(h => [s, ...h.filter(x => x.sONGBM !== s.sONGBM)].slice(0, 100))
  }
  const total = queue.items.length
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [refresh])

  const act: Act = (action, val = '', label, icon, song, origin) => {
    const show = (text: string, i?: IconName, tone?: 'error') => {
      // Pill mirrors the pressed button: Add is accent-filled, everything else neutral.
      setToast({ text, icon: i, tone: tone ?? (i === 'cloud' ? 'cloud' : action === 'add-song' ? 'accent' : undefined), on: true })
      clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(t => ({ ...t, on: false })), longPopups ? 4500 : 2500)
    }
    command(action, val, song, origin).then(() => { show(label ?? REMOTE_LABELS[action] ?? action, icon); if (song) record(song); refresh() }).catch(() => { show("Not sent · can't reach the KTV machine", undefined, 'error'); refresh() })
  }

  const cloudIds = useMemo(() => {
    const queued = new Map<string, number>()
    queue.items.forEach(q => queued.set(String(q.sONGBM), (queued.get(String(q.sONGBM)) ?? 0) + 1))
    return { pending: new Set(queue.pending.map(p => String(p.sONGBM))), downloaded: new Set(queue.downloaded), queued }
  }, [queue.items, queue.pending, queue.downloaded])
  const item = (on: boolean, extra = '') => `flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] transition duration-150 active:scale-95 lg:flex-none lg:flex-row lg:gap-2 lg:px-4 lg:text-sm ${on ? 'bg-accent/15 font-bold text-accent' : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'} ${extra}`
  const go = (k: Tab) => { setTab(k); setMenu(null); setSettings(false) }
  const tabBtn = (k: Tab) => (
    <button key={k} onClick={() => go(k)} className={item(!settings && tab === k)}>
      <Icon name={k} className="size-5 lg:size-4" /><span className="grid justify-items-center whitespace-nowrap">{/* the bold label is reserved invisibly, so selecting a tab (which turns it bold) never changes its width */}<span aria-hidden className="invisible col-start-1 row-start-1 h-0 font-bold">{TABS.find(t => t[0] === k)![1]}</span><span className="col-start-1 row-start-1">{TABS.find(t => t[0] === k)![1]}</span></span>
    </button>
  )
  const playing = !!queue.current
  const lg = useLg()
  const popup = menu === 'queue' && !lg
  const vv = useVisualViewport()
  // The record breaks out of the bar: it is the one control that is also a status light.
  const queueBtn = (
    <button key="queue" data-popup onClick={() => setMenu(menu === 'queue' ? null : 'queue')} className="relative -my-6 w-[4.75rem] shrink-0 self-center transition active:scale-95" aria-label={`Queue${total ? `, ${total} songs` : ''}`} aria-pressed={menu === 'queue'}>
      <Disc spin={playing} className={`mx-auto size-16 shadow-lg ring-4 ${menu === 'queue' ? 'ring-accent' : 'ring-white dark:ring-zinc-900'}`} />
      {total > 0 && <span className="absolute right-0.5 top-0 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-white dark:ring-zinc-900">{total}</span>}
    </button>
  )
  const settingsBtn = (
    <button key="settings" onClick={() => { setMenu(null); setSettings(!settings) }} className={item(settings)}>
      <Icon name="settings" className="size-5" /><span>Settings</span>
    </button>
  )
  const banner$ = <NowBanner current={queue.current} next={queue.items[0]} onOpen={() => setMenu('queue')} />
  const panel = <QueuePanel view={qView} setView={setQView} queue={queue} history={history} act={act} favs={favs} />

  if (cfgHost === null || fails >= 3)
    return <Landing host={cfgHost ?? null} onConnected={h => { setCfgHost(h); setFails(0); refresh() }} />

  return (
    <CloudCtx.Provider value={cloudIds}>
    <div data-queue-open={popup || undefined} className={`mx-auto min-h-dvh max-w-7xl ${bannerOn && banner === 'toolbar' ? 'pb-44' : 'pb-28'} lg:pb-6`}>
      {menu && !(menu === 'queue' && lg) && <div data-dim className={`animate-fade pointer-events-none fixed inset-0 z-[15] bg-black/40 max-md:pointer-events-auto max-md:touch-none md:z-[5] ${popup ? 'max-lg:pointer-events-auto max-lg:touch-none' : ''}`} />}
      <div className={`sticky top-0 z-10 ${opaqueBars ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-zinc-50/90 backdrop-blur dark:bg-zinc-950/90'}`}>
      {bannerOn && banner === 'top' && <div className="lg:hidden">{banner$}</div>}
      <header className={`flex items-center gap-3 p-3 ${settings ? 'max-lg:hidden' : ''}`}>
        <h1 className="hidden sm:block"><Logo size={24} text={28} /></h1>
        <nav className="hidden lg:flex lg:gap-2">{TABS.map(([k]) => tabBtn(k))}</nav>
        <div className={`min-w-0 flex-1 ${settings ? 'invisible' : ''}`} data-popup>
          <div className="relative">
          <input value={q} onChange={e => setQ(e.target.value)} type="search" placeholder={`Search ${tab}…`}
            className="w-full rounded-xl bg-zinc-200 py-3 pl-4 pr-40 outline-none focus:ring-2 focus:ring-accent dark:bg-zinc-800" />
          <button aria-label="Filters" onClick={() => setMenu(menu === 'filter' ? null : 'filter')}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition duration-150 hover:brightness-110 active:scale-95 after:content-['▾'] ${activeLabel ? 'bg-accent text-white' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
              <span className="block max-w-28 truncate">{activeLabel ?? 'Filter'}</span>
            </button>
          </div>
        </div>
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <SettingsMenu open={settings} onClick={() => { setMenu(null); setSettings(!settings) }} />
        </div>
      </header>
            </div>
      {online !== true && (
        <div role="status" className={`mx-3 mb-2 rounded-xl px-4 py-2 text-sm ${online === false ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800'}`}>
          {online === false ? "Can't reach the KTV machine. Retrying…" : 'Connecting to the KTV machine…'}
        </div>
      )}

      <div className="flex gap-6 px-3">
        <main className={`min-w-0 flex-1 ${settings ? "pt-6 lg:pt-2" : "pt-2"}`}>
          {settings
            ? <SettingsPage t={theme} online={online} host={cfgHost} favs={favList.length} history={history.length} cats={cats.length} onManage={() => setModal({ kind: 'manage' })} reload={reload} />
            : <>
              <div hidden={tab !== 'songs'}><Songs q={sq} act={from(act, 'songs')} filter={sf} epoch={epoch} favs={favs} /></div>
              {tab === 'favorites' && <SavedList name="favorites" items={shownFavs} q={q} cat={catSel} act={from(act, 'favorites')} favs={favs} empty={favList.length ? 'No songs in this category.' : 'No favorites yet. Double-tap a song to save it.'} />}
              <div hidden={tab !== 'singers'}><Singers epoch={epoch} q={gq} area={ga} onPick={name => { setFilter({ singer: name }); setQ(''); setTab('songs') }} /></div>
            </>}
        </main>
        <aside className="sticky top-[4.5rem] hidden h-[calc(100dvh-6rem)] w-96 shrink-0 pt-2 lg:block">{lg && panel}</aside>
      </div>

      {bannerOn && banner === 'toolbar' && menu !== 'queue' && <div className="fixed inset-x-0 bottom-[5.75rem] z-10 lg:hidden">{banner$}</div>}
      <nav className={'fixed inset-x-3 bottom-3 z-[25] flex gap-1 rounded-2xl border border-zinc-200/70 p-1.5 shadow-xl shadow-black/10 dark:border-zinc-700/60 lg:hidden ' + (opaqueBars ? 'bg-white dark:bg-zinc-900' : 'bg-white/85 backdrop-blur dark:bg-zinc-900/85')}>
        {tabBtn('songs')}{tabBtn('singers')}{queueBtn}{tabBtn('favorites')}{settingsBtn}
      </nav>
      {/* md+: same width/centering as the page container so popups line up with the header. Phones: popups are flex children above the toolbar, like Modal */}
      <div className="pointer-events-none fixed inset-0 z-20 mx-auto max-w-7xl max-md:flex max-md:items-end max-md:justify-center max-md:p-3 max-md:pb-[5.5rem]">
      {menu === 'filter' && <FilterPanel tab={tab} filter={filter} setFilter={setFilter} area={area} setArea={setArea} cats={cats} catFilter={catSel} setCatFilter={setCatFilter} close={() => setMenu(null)} />}
      </div>
      {popup && (
        <div style={vv ? { top: vv.top, height: vv.height } : { top: 0, bottom: 0 }} className="pointer-events-none fixed inset-x-0 z-20 flex justify-center px-3 pt-3 pb-24">
          <div data-popup className="animate-pop pointer-events-auto h-full w-full max-w-md overflow-hidden rounded-2xl bg-zinc-100 p-3 shadow-xl ring-1 ring-black/10 dark:bg-zinc-950 dark:ring-white/10">{panel}</div>
        </div>
      )}
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
