import { useEffect, useState } from 'react'

export const ACCENTS = { violet: '#8b5cf6' } as const
export type Mode = 'system' | 'light' | 'dark'

const get = <T,>(k: string, d: T) => (localStorage.getItem(k) as T | null) ?? d

export function useTheme() {
  const [mode, setMode] = useState<Mode>(get('mode', 'dark'))
  const [accent, setAccent] = useState<keyof typeof ACCENTS>(() => { const a = get('accent', 'violet'); return a in ACCENTS ? a : 'violet' }) // a saved accent that was dropped falls back to violet
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && mq.matches))
    apply(); mq.addEventListener('change', apply)
    localStorage.setItem('mode', mode)
    return () => mq.removeEventListener('change', apply)
  }, [mode])
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENTS[accent])
    localStorage.setItem('accent', accent)
  }, [accent])
  return { mode, setMode, accent, setAccent }
}
