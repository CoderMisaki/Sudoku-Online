"use client";

import { useEffect, useState } from 'react';
import { Bug, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getErrorLogs, clearErrorLogs, subscribeErrorLogs, type ErrorLogEntry } from '@/utils/errorLogger';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

export const ErrorLogPanel: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<ErrorLogEntry[]>(() => getErrorLogs());

  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external error store to state on mount is intentional
    setLogs(getErrorLogs());
    const unsub = subscribeErrorLogs(() => setLogs(getErrorLogs()));
    return unsub;
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="relative flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 hover:bg-red-500/15 text-red-600 dark:text-red-400 px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
        title="Lihat error logs (Admin only)"
        aria-label="Buka error logs"
      >
        <Bug className="w-4 h-4" />
        <span className="hidden sm:inline">Logs</span>
        {logs.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {logs.length > 99 ? '99+' : logs.length}
          </span>
        )}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={`Error Logs (${logs.length})`}>
        <div className="flex flex-col gap-3 max-h-[60vh]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-secondary">Hanya terlihat untuk username <b>ADMIN</b>. Log disimpan lokal (max 100).</p>
            <Button variant="ghost" size="sm" onClick={() => clearErrorLogs()} disabled={logs.length === 0} className="gap-1.5 text-red-600 hover:bg-red-500/10 shrink-0">
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-background divide-y divide-border min-h-[200px]">
            {logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-secondary">Belum ada error tercatat ✅</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="p-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${log.level === 'error' ? 'bg-red-500/15 text-red-600' : log.level === 'warn' ? 'bg-amber-500/15 text-amber-600' : 'bg-secondary/10 text-secondary'}`}>{log.level.toUpperCase()}</span>
                    <span className="text-[11px] text-secondary font-mono">{formatTime(log.timestamp)}</span>
                  </div>
                  <p className="text-xs font-medium break-words">{log.message}</p>
                  {log.source && <p className="text-[11px] text-secondary">↳ {log.source}</p>}
                  {log.stack && (
                    <pre className="text-[10px] bg-secondary/10 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-[120px]">{log.stack.slice(0, 800)}</pre>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setIsOpen(false)} className="gap-1.5">
              <X className="w-3.5 h-3.5" /> Tutup
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
