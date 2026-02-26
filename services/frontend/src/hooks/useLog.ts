import { useState, useCallback } from 'react'

export interface LogEntry {
  id: string
  timestamp: string
  method: string
  url: string
  status?: number
  note?: string
  body_type?: string
  response_size?: number
  params?: Record<string, unknown>
}

export function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])

  const addEntries = useCallback((newEntries: LogEntry[]) => {
    const stamped = newEntries.map(e => ({
      ...e,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }))
    setEntries(prev => [...prev, ...stamped])
  }, [])

  const clearLog = useCallback(() => setEntries([]), [])

  const processResponse = useCallback(
    (data: { log?: LogEntry[]; result?: unknown }) => {
      if (data.log && Array.isArray(data.log)) {
        addEntries(data.log)
      }
      return data.result
    },
    [addEntries]
  )

  return { entries, addEntries, clearLog, processResponse }
}
