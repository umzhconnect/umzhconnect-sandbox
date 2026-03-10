import React, { createContext, useContext, useState, useCallback } from 'react';
import type { LogEntry } from '../types/fhir';

interface LogContextType {
  logs: LogEntry[];
  addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
}

const LogContext = createContext<LogContextType>({
  logs: [],
  addLog: () => {},
  clearLogs: () => {},
});

export const useLog = () => useContext(LogContext);

export const LogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    const logEntry: LogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    setLogs((prev) => [logEntry, ...prev].slice(0, 200));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return (
    <LogContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </LogContext.Provider>
  );
};
