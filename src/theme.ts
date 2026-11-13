import { useEffect, useState } from 'react'

export const ACCENTS = { pink: '#ec4899', blue: '#3b82f6', green: '#22c55e', amber: '#f59e0b', violet: '#8b5cf6' } as const
export type Mode = 'system' | 'light' | 'dark'

const get = <T,>(k: string, d: T) => (localStorage.getItem(k) as T | null) ?? d

export function useTheme() {
  const [mode, setMode] = useState<Mode>(get('mode', 'system'))
  const [accent, setAccent] = useState<keyof typeof ACCENTS>(get('accent', 'pink'))
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
