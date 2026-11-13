import { createContext, useContext, useEffect, useState, type ComponentType } from 'react'
import { AudioLines, Cloud, ListStart, ListMusic, Mic, MicVocal, Music, Plus, RotateCcw, Settings, SkipForward, SlidersHorizontal, Play, VolumeX, X } from 'lucide-react'

export type Settings = { opaqueBars: boolean; svgIcons: boolean; showMic: boolean; longPopups: boolean; helperLabels: boolean; hideAltNames: boolean }
const DEFAULTS: Settings = { opaqueBars: false, svgIcons: true, showMic: true, longPopups: false, helperLabels: false, hideAltNames: true }

export function useSettingsState() {
  const [s, set] = useState<Settings>(() => ({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') ?? '{}') }))
  useEffect(() => localStorage.setItem('settings', JSON.stringify(s)), [s])
  return { ...s, toggle: (k: keyof Settings) => set(prev => ({ ...prev, [k]: !prev[k] })) }
}

export const SettingsCtx = createContext<Settings>(DEFAULTS)

// name -> [svg, emoji fallback]
const ICONS = {
  songs: [Music, '🎵'], singers: [MicVocal, '🎤'], queue: [ListMusic, '📋'], remote: [SlidersHorizontal, '🎛'],
  next: [ListStart, '⏫'], remove: [X, '✕'], add: [Plus, '＋'], settings: [Settings, '⚙️'], playing: [AudioLines, '🔊'],
  skip: [SkipForward, '⏭'], replay: [RotateCcw, '↺'], play: [Play, '⏯'], mute: [VolumeX, '🔇'], karaoke: [Mic, '🎤'], cloud: [Cloud, '☁️'],
} as const satisfies Record<string, readonly [ComponentType<{ className?: string }>, string]>

export type IconName = keyof typeof ICONS
export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  const { svgIcons } = useContext(SettingsCtx)
  const [Svg, emoji] = ICONS[name]
  return svgIcons ? <Svg className={className} aria-hidden /> : <span aria-hidden className="leading-none">{emoji}</span>
}
