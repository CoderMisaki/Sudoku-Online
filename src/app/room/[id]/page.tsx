"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore } from '../../../store/gameStore';
import { useRealtime } from '../../../hooks/useRealtime';
import { getOrCreateUserId } from '../../../utils/uuid';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { SudokuBoard } from '../../../components/game/SudokuBoard';
import { Copy, Users, Settings, LogOut, CheckCircle2, RotateCw, Terminal, AlertOctagon } from 'lucide-react';
import { Difficulty, GameMode } from '../../../types/game';
import toast from 'react-hot-toast';

export default function RoomPage() {
  const params = useParams();
  const roomId = (params?.id as string) || '';
  const router = useRouter();

  const userId = useGameStore(state => state.userId);
  const username = useGameStore(state => state.username);
  const room = useGameStore(state => state.room);
  const enterRoom = useGameStore(state => state.enterRoom);
  const grid = useGameStore(state => state.grid);
  const resetGame = useGameStore(state => state.resetGame);
  const setUserInfo = useGameStore(state => state.setUserInfo);

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const initHostRef = useRef(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  const {
    broadcastMove,
    broadcastNote,
    broadcastCursor,
    lockCell,
    locks,
    broadcastLeaveRoom,
    broadcastNextGame,
    requestState,
    realtimeStatus,
    isTrulyOffline,
    connectionError,
    debugLogs,
    reconnect
  } = useRealtime(roomId);

  useEffect(() => {
    if (!roomId) return;
    const storedUserId = getOrCreateUserId();
    const storedUsername = typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') : null;

    if (!storedUserId || !storedUsername) {
      router.push('/');
      return;
    }

    setUserInfo(storedUserId, storedUsername);
    enterRoom(roomId);

    let isHost = false;
    let difficulty: Difficulty = 'medium';
    let mode: GameMode = 'collaborative';
    let maxPlayers = 4;

    const roomConfigStr = sessionStorage.getItem(`sudoku_room_config_${roomId}`);
    if (roomConfigStr) {
      try {
        const config = JSON.parse(roomConfigStr);
        isHost = Boolean(config.isHost);
        if (isHost) {
          difficulty = (config.difficulty as Difficulty) || 'medium';
          mode = (config.mode as GameMode) || 'collaborative';
          maxPlayers = config.maxPlayers || 4;
        }
      } catch (e) {
        console.error(e);
      }
    }

    const isHostFromSession = sessionStorage.getItem(`sudoku_host_room_${roomId}`) === '1';
    if ((isHost || isHostFromSession) && !initHostRef.current) {
      initHostRef.current = true;

      const currentState = useGameStore.getState();

      currentState.setRoom({
        id: roomId,
        code: roomId,
        hostId: storedUserId,
        difficulty,
        mode,
        maxPlayers,
        status: 'playing',
        players: {
          [storedUserId]: {
            id: storedUserId,
            username: storedUsername,
            color: '#3b82f6',
            isHost: true,
            score: 0,
            hints: 3,
            status: 'online',
          },
        },
        createdAt: Date.now(),
        startedAt: Date.now(),
      });

      // Jika mode snakes, buat state awal snakes and ladders
      if (mode === 'snakes_and_ladders') {
        currentState.updateSnakesState({
          currentTurnUserId: storedUserId,
          turnOrder: [storedUserId],
          diceValue: null,
          isRolling: false,
          playerPositions: {
            [storedUserId]: 1,
          },
          winnerId: null,
        });
      } else {
        // Mode Sudoku biasa
        fetch('/api/game/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty }),
        })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.initialGrid || !data.solutionToken) {
              throw new Error(data.error || `HTTP ${res.status}`);
            }

            currentState.setGameData(data.initialGrid, data.solutionToken);
          })
          .catch((err) => {
            console.error('Failed to create puzzle:', err);
            toast.error(`Gagal membuat puzzle: ${err.message}. Cek ROOM_SECRET_KEY / server.`);
          });
      }
    }

    const timer = setTimeout(() => {
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [roomId, router, setUserInfo, enterRoom]);

  const snakesState = useGameStore(state => state.snakesState);
  const isSnakesMode = room?.mode === 'snakes_and_ladders';
  const hasBoardData = isSnakesMode ? Boolean(snakesState) : Boolean(grid);

  useEffect(() => {
    if (realtimeStatus === 'SUBSCRIBED' && !hasBoardData) {
      const timer = setTimeout(() => {
        requestState();
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [realtimeStatus, hasBoardData, requestState]);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      await broadcastLeaveRoom();
    } finally {
      sessionStorage.removeItem(`sudoku_host_room_${roomId}`);
      sessionStorage.removeItem(`sudoku_room_config_${roomId}`);
      resetGame();
      router.replace('/');
    }
  };

  const handlePromoteAndCreateBoard = async () => {
    const currentUid = userId || getOrCreateUserId();
    const currentUsername = username || 'Player';
    sessionStorage.setItem(`sudoku_host_room_${roomId}`, '1');

    const newRoom = {
      id: roomId,
      code: roomId,
      hostId: currentUid,
      difficulty: ('medium' as Difficulty),
      mode: ('collaborative' as GameMode),
      maxPlayers: 4,
      status: 'playing' as const,
      players: {
        [currentUid]: {
          id: currentUid,
          username: currentUsername,
          color: '#3b82f6',
          isHost: true,
          score: 0,
          hints: 3,
          status: 'online' as const,
        },
      },
      createdAt: Date.now(),
      startedAt: Date.now(),
    };
    useGameStore.getState().setRoom(newRoom);

    try {
      toast.loading('Membuat puzzle baru...', { id: 'create-board' });
      const res = await fetch('/api/game/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: 'medium' }),
      });
      const data = await res.json();
      if (data.initialGrid && data.solutionToken) {
        useGameStore.getState().setGameData(data.initialGrid, data.solutionToken);
        broadcastNextGame(data.initialGrid, data.solutionToken, newRoom);
        toast.success('Kamu sekarang adalah Host room ini! 👑', { id: 'create-board' });
      }
    } catch {
      toast.error('Gagal membuat puzzle baru.', { id: 'create-board' });
    }
  };

  // Tampilan Menunggu Host / Stuck Loading Fallback
  if (loading || !hasBoardData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6 text-center space-y-5 max-w-lg mx-auto">
        <div className="space-y-3 w-full">
          <div className="w-12 h-12 border-4 border-foreground border-t-transparent rounded-full animate-spin mx-auto mb-2" />

          <h2 className="text-xl font-bold">
            {isTrulyOffline ? 'Room Offline / Host Tidak Ditemukan' : 'Menghubungkan ke Room...'}
          </h2>

          <p className="text-secondary text-sm">
            {isTrulyOffline
              ? `Room ${roomId} tidak aktif atau Host belum membuat papan permainan.`
              : `Menyinkronkan data puzzle dari host untuk room ${roomId}...`}
          </p>

          {/* Banner Status Realtime */}
          <div className="bg-card border border-border p-3.5 rounded-xl text-left font-mono text-xs space-y-1.5 shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-secondary">Status Realtime:</span>
              <span className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                realtimeStatus === 'SUBSCRIBED' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'
              }`}>
                {realtimeStatus}
              </span>
            </div>
            {connectionError && (
              <div className="text-red-400 font-semibold flex items-center gap-1.5 pt-1">
                <AlertOctagon className="w-3.5 h-3.5 flex-shrink-0" />
                {connectionError}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 w-full pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              reconnect();
              requestState();
              toast.success('Mencoba sinkronisasi ulang...');
            }}
          >
            <RotateCw className="w-4 h-4 mr-2" /> Coba Lagi
          </Button>

          <Button
            size="sm"
            onClick={handlePromoteAndCreateBoard}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            Jadikan Saya Host (Buat Soal)
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={leaveRoom}
            className="text-red-500 hover:bg-red-500/10"
          >
            <LogOut className="w-4 h-4 mr-2" /> Keluar ke Beranda
          </Button>
        </div>

        {/* Live Debug Logs Accordion */}
        <div className="w-full text-left pt-2">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-xs text-secondary hover:text-foreground flex items-center gap-1.5 font-mono cursor-pointer mx-auto"
          >
            <Terminal className="w-3.5 h-3.5" />
            {showLogs ? 'Sembunyikan Debug Logs' : 'Lihat Live Debug Logs'}
          </button>

          {showLogs && (
            <div className="mt-3 bg-black text-green-400 font-mono text-[11px] p-3 rounded-xl border border-border/40 max-h-48 overflow-y-auto space-y-1">
              {debugLogs.length === 0 ? (
                <div className="text-zinc-500">Belum ada log aktif...</div>
              ) : (
                debugLogs.map((log, idx) => <div key={idx}>{log}</div>)
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-4">
          <h1 className="text-base sm:text-xl font-bold truncate">Sudoku</h1>
          <div className="flex items-center gap-1.5 text-xs text-secondary bg-background px-2.5 py-1 rounded-full border border-border">
            <span className="hidden sm:inline">Code:</span>
            <span className="font-mono font-medium text-foreground tracking-wider">{roomId}</span>
            <button onClick={copyRoomCode} className="hover:text-foreground transition-colors p-0.5 cursor-pointer">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs(!showLogs)}
            className="h-8 px-2 text-xs font-mono text-secondary"
            title="Toggle Debug Logs"
          >
            <Terminal className="w-4 h-4 mr-1" /> Logs
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 h-8 w-8"
          >
            <Settings className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={leaveRoom}
            disabled={isLeaving}
            className="h-8 px-2.5 text-xs text-red-500 border-red-500/30 hover:bg-red-500/10"
          >
            <LogOut className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">{isLeaving ? 'Leaving...' : 'Leave'}</span>
          </Button>
        </div>
      </header>

      {/* Main Game Interface */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Sidebar Left */}
        <div className="space-y-4 flex flex-col h-full lg:col-span-2">
          <Card className="p-3 border-b border-border bg-background/50">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Users className="w-4 h-4" /> Players ({Object.keys(room?.players || {}).length})
              </h2>
            </div>
            <div className="space-y-2 text-xs sm:text-sm">
              {Object.values(room?.players || {}).map(p => (
                <div key={p.id} className="flex items-center justify-between">
                  <span className="font-medium">{p.username} {p.isHost ? '(Host)' : ''}</span>
                  <span className="font-mono">{p.score}</span>
                </div>
              ))}
            </div>
          </Card>

          {showLogs && (
            <div className="bg-black text-green-400 font-mono text-[11px] p-3 rounded-xl border border-border/40 max-h-44 overflow-y-auto space-y-1">
              <div className="text-zinc-500 font-bold border-b border-zinc-800 pb-1 mb-1">LIVE LOGS:</div>
              {debugLogs.map((log, idx) => <div key={idx}>{log}</div>)}
            </div>
          )}
        </div>

        {/* Center: Game Board */}
        <div className="lg:col-span-3 flex flex-col items-center justify-center">
          <SudokuBoard
            broadcastMove={broadcastMove}
            broadcastNote={broadcastNote}
            broadcastCursor={broadcastCursor}
            lockCell={lockCell}
            locks={locks}
            isPencilMode={false}
            isEraserMode={false}
          />
        </div>
      </main>

      {/* Settings Modal */}
      <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Settings">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Theme</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                if (nextTheme === 'dark') {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              }}
            >
              {theme === 'dark' ? 'Dark' : 'Light'}
            </Button>
          </div>
          <div className="flex justify-end pt-4 border-t border-border">
            <Button onClick={() => setIsSettingsOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
