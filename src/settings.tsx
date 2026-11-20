import { createContext, useContext, useEffect, useState, type ComponentType } from 'react'
import { AudioLines, Check, Cloud, CloudDownload, GripVertical, Heart, HeartCrack, LoaderCircle, History, ListStart, ListMusic, Mic, MicVocal, Music, Pencil, Plus, RotateCcw, Settings, SkipBack, SkipForward, SlidersHorizontal, Play, Tag, Trash2, VolumeX, X } from 'lucide-react'

export type Banner = 'off' | 'search' | 'toolbar'
export type Settings = { opaqueBars: boolean; svgIcons: boolean; showMic: boolean; showMusic: boolean; longPopups: boolean; helperLabels: boolean; hideAltNames: boolean; playerControls: boolean; banner: Banner }
type Flag = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]
const DEFAULTS: Settings = { opaqueBars: false, svgIcons: true, showMic: false, showMusic: false, longPopups: false, helperLabels: false, hideAltNames: true, playerControls: true, banner: 'off' }

export function useSettingsState() {
  const [s, set] = useState<Settings>(() => ({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }))
  useEffect(() => localStorage.setItem('settings', JSON.stringify(s)), [s])
  return { ...s, toggle: (k: Flag) => set(prev => ({ ...prev, [k]: !prev[k] })), setBanner: (banner: Banner) => set(prev => ({ ...prev, banner })) }
}

export const SettingsCtx = createContext<Settings>(DEFAULTS)

// name -> [svg, emoji fallback]
const ICONS = {
  songs: [Music, '🎵'], singers: [MicVocal, '🎤'], queue: [ListMusic, '📋'], favorites: [Heart, '♥'], history: [History, '🕘'], tag: [Tag, '🏷'], check: [Check, '✓'], unfav: [HeartCrack, '💔'], edit: [Pencil, '✎'], grip: [GripVertical, '⠿'], trash: [Trash2, '🗑'], remote: [SlidersHorizontal, '🎛'],
  next: [ListStart, '⏫'], remove: [X, '✕'], add: [Plus, '＋'], settings: [Settings, '⚙️'], playing: [AudioLines, '🔊'],
  skip: [SkipForward, '⏭'], restart: [SkipBack, '⏮'], replay: [RotateCcw, '↺'], play: [Play, '⏯'], mute: [VolumeX, '🔇'], karaoke: [Mic, '🎤'], cloud: [Cloud, '☁️'], download: [CloudDownload, '⬇️'], loading: [LoaderCircle, '⏳'],
} as const satisfies Record<string, readonly [ComponentType<{ className?: string }>, string]>

export type IconName = keyof typeof ICONS
export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  const { svgIcons } = useContext(SettingsCtx)
  const [Svg, emoji] = ICONS[name]
  return svgIcons ? <Svg className={className} aria-hidden /> : <span aria-hidden className="leading-none">{emoji}</span>
}
