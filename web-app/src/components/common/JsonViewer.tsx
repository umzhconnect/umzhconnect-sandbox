import React, { useState } from 'react';

interface JsonViewerProps {
  data: unknown;
  title?: string;
  collapsed?: boolean;
  maxHeight?: string;
}

const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  title,
  collapsed = false,
  maxHeight = '400px',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const [copied, setCopied] = useState(false);

  const jsonStr = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {title && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <svg
              className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {title}
          </button>
          <button
            onClick={handleCopy}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {!isCollapsed && (
        <pre
          className="p-3 text-xs font-mono overflow-auto bg-gray-900 text-green-400"
          style={{ maxHeight }}
        >
          {jsonStr}
        </pre>
      )}
    </div>
  );
};

export default JsonViewer;
