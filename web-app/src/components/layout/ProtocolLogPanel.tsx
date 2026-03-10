import React from 'react';
import { useLog } from '../../contexts/LogContext';
import JsonViewer from '../common/JsonViewer';

const getEntryBorderClass = (type: string) => {
  switch (type) {
    case 'request':  return 'border-l-2 border-blue-400';
    case 'response': return 'border-l-2 border-green-400';
    case 'error':    return 'border-l-2 border-red-400';
    default:         return 'border-l-2 border-gray-300';
  }
};

const getTypeBadgeClass = (type: string) => {
  switch (type) {
    case 'request':  return 'bg-blue-200 text-blue-900';
    case 'response': return 'bg-green-200 text-green-900';
    case 'error':    return 'bg-red-200 text-red-900';
    default:         return 'bg-gray-200 text-gray-700';
  }
};

const METHOD_COLORS: Record<string, string> = {
  GET:    'bg-green-100 text-green-800',
  POST:   'bg-blue-100 text-blue-800',
  PUT:    'bg-yellow-100 text-yellow-800',
  PATCH:  'bg-orange-100 text-orange-800',
  DELETE: 'bg-red-100 text-red-800',
};

const ProtocolLogPanel: React.FC = () => {
  const { logs, clearLogs } = useLog();

  return (
    <aside className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Protocol Log</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{logs.length}</span>
          <button
            onClick={clearLogs}
            className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Scrollable entries */}
      <div className="flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 px-4 text-center">
            <svg className="w-8 h-8 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <p className="text-xs">No entries yet</p>
            <p className="text-xs mt-1 opacity-70">API calls will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => (
              <div key={log.id} className={`px-3 py-2 text-xs ${getEntryBorderClass(log.type)}`}>
                {/* Row 1: badges + time */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span className={`font-bold rounded px-1 py-0.5 ${getTypeBadgeClass(log.type)}`}>
                    {log.type.toUpperCase().slice(0, 3)}
                  </span>
                  {log.method && (
                    <span className={`font-bold rounded px-1 py-0.5 ${METHOD_COLORS[log.method] ?? 'bg-gray-100 text-gray-700'}`}>
                      {log.method}
                    </span>
                  )}
                  {log.status != null && (
                    <span className={`font-bold ${log.status < 300 ? 'text-green-700' : log.status < 400 ? 'text-yellow-700' : 'text-red-700'}`}>
                      {log.status}
                    </span>
                  )}
                  {log.duration != null && (
                    <span className="text-gray-400">{log.duration}ms</span>
                  )}
                  <span className="text-gray-400 ml-auto tabular-nums">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                {/* Row 2: URL */}
                {log.url && (
                  <div className="font-mono text-gray-600 break-all mt-1 leading-tight">
                    {log.url}
                  </div>
                )}

                {/* Row 3: message */}
                {log.message && (
                  <div className="text-gray-500 mt-0.5 italic leading-tight">{log.message}</div>
                )}

                {/* Expandable payload */}
                {log.body != null && (
                  <details className="mt-1">
                    <summary className="text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                      payload
                    </summary>
                    <div className="mt-1">
                      <JsonViewer data={log.body} maxHeight="150px" />
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default ProtocolLogPanel;
