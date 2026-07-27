"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore } from '../../../store/gameStore';
import { useRealtime } from '../../../hooks/useRealtime';
import { generatePuzzle, isValidMove } from '../../../utils/sudoku';
import { getOrCreateUserId } from '../../../utils/uuid';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { SudokuBoard } from '../../../components/game/SudokuBoard';
import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, AlertTriangle, WifiOff } from 'lucide-react';
import { isSupabaseEnvValid } from '../../../services/supabase';
import { Difficulty, GameMode } from '../../../types/game';
import toast from 'react-hot-toast';

const PLAYER_COLORS = ['#666666', '#111111', '#333333', '#475569', '#374151'];

export default function RoomPage() {
  const params = useParams();
  const roomId = (params?.id as string) || '';
  const router = useRouter();

  const userId = useGameStore(state => state.userId);
  const username = useGameStore(state => state.username);
  const room = useGameStore(state => state.room);
  const setRoom = useGameStore(state => state.setRoom);
  const enterRoom = useGameStore(state => state.enterRoom);
  const grid = useGameStore(state => state.grid);
  const resetGame = useGameStore(state => state.resetGame);
  const setGameData = useGameStore(state => state.setGameData);
  const setUserInfo = useGameStore(state => state.setUserInfo);
  const updateCell = useGameStore(state => state.updateCell);
  const solution = useGameStore(state => state.solution);
  const selectedCell = useGameStore(state => state.selectedCell);
  const messages = useGameStore(state => state.messages);
  const player = useGameStore(state => state.room?.players[userId || '']);
  const hintsRemaining = player?.hints ?? 3;

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');


  const applyTheme = useCallback((newTheme: 'light' | 'dark' | 'system') => {
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else if (newTheme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.remove('dark', 'light');
    }
  }, []);

  useEffect(() => {
    const storedTheme = localStorage.getItem('sudoku_theme') as 'light' | 'dark' | 'system' || 'system';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(storedTheme);
    applyTheme(storedTheme);
  }, [applyTheme]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('sudoku_theme', newTheme);
    applyTheme(newTheme);
  };
  const { broadcastMove, broadcastCursor, lockCell, locks, broadcastChat, realtimeStatus, connectionError } = useRealtime(roomId);
  const [chatInput, setChatInput] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Perhitungan timer real-time berdasarkan room.startedAt
  useEffect(() => {
    if (!room?.startedAt) return;

    const updateTimer = () => {
      const now = Date.now();
      const diffInSeconds = Math.floor((now - room.startedAt!) / 1000);
      setElapsedTime(diffInSeconds > 0 ? diffInSeconds : 0);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [room?.startedAt]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleChatSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (chatInput.trim()) {
      broadcastChat(chatInput.trim());
      setChatInput('');
      const textarea = document.getElementById('chat-textarea');
      if (textarea) {
        textarea.style.height = '40px';
      }
    }
  };



  // Initialize Realtime


  useEffect(() => {
    if (!roomId) return;

    const storedUserId = getOrCreateUserId();
    const storedUsername =
      typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') : null;

    if (!storedUserId || !storedUsername) {
      router.push('/');
      return;
    }

    if (!userId) {
      setUserInfo(storedUserId, storedUsername);
    }

    // Ensure we enter the right room and clear stale state if different
    enterRoom(roomId);

    let isHostFromConfig = false;
    let difficulty: Difficulty = 'medium';
    let mode: GameMode = 'collaborative';
    let maxPlayers = 4;

    const tempConfigStr = sessionStorage.getItem('temp_room_config');

    if (tempConfigStr) {
      try {
        const config = JSON.parse(tempConfigStr);

        isHostFromConfig = Boolean(config.isHost);

        if (isHostFromConfig) {
          difficulty = (config.difficulty as Difficulty) || 'medium';
          mode = (config.mode as GameMode) || 'collaborative';
          maxPlayers = config.maxPlayers || 4;
        }
      } catch (error) {
        console.error('Failed to parse temp_room_config', error);
      }

      sessionStorage.removeItem('temp_room_config');
    }

    const currentState = useGameStore.getState();
    const existingRoom = currentState.room;

    const isHostFromStorage = existingRoom?.hostId === storedUserId;
    const isHostFromSession = sessionStorage.getItem(`sudoku_host_room_${roomId}`) === '1';

    const isHost = isHostFromConfig || isHostFromStorage || isHostFromSession;

    // Host makes a new puzzle only if there is no room for this roomId
    if (!existingRoom && isHost) {
      const { initialGrid, solutionGrid } = generatePuzzle(difficulty);

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
            color: PLAYER_COLORS[0],
            isHost: true,
            score: 0,
            hints: 3,
            status: 'online',
          },
        },
        createdAt: Date.now(),
        startedAt: Date.now(),
      });

      currentState.setGameData(initialGrid, solutionGrid);
    }

    const t = setTimeout(() => setLoading(false), 0);

    return () => clearTimeout(t);
  }, [
    roomId,
    router,
    userId,
    room,
    setRoom,
    setGameData,
    setUserInfo,
    enterRoom,
  ]);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    sessionStorage.removeItem(`sudoku_host_room_${roomId}`);
    resetGame();
    router.push('/');
  };


  const handleHint = useCallback(() => {
    if (!userId) return;
    if (!selectedCell) {
      toast.error('Pilih kotak kosong terlebih dahulu untuk menggunakan hint!');
      return;
    }

    const hintData = useGameStore.getState().useHint(userId);
    if (hintData) {
      updateCell(hintData.row, hintData.col, hintData.value, userId);
      broadcastMove(hintData.row, hintData.col, hintData.value);
      toast.success('Hint digunakan untuk 1 kotak!');
    } else {
      toast.error('Pilih kotak yang belum terisi angka yang benar.');
    }
  }, [userId, selectedCell, updateCell, broadcastMove]);


  const handleNumpadClick = useCallback((num: number) => {
    if (!selectedCell || !userId) return;

    // Tarik state grid manual agar kita bisa jalankan verifikasinya
    const grid = useGameStore.getState().grid;
    if (!grid) return;

    const { row, col } = selectedCell;
    const cell = grid[row][col];

    if (cell.isLocked) return;

    // Cek apakah cell sedang dikunci pemain lain
    const key = `${row}-${col}`;
    const currentLock = locks[key];
    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return;
    }

    // Blokir jika melanggar logika posisi Sudoku
    if (!isValidMove(grid, row, col, num)) {
      toast.error('Angka sudah ada di baris/kolom/blok!', { id: 'conflict', duration: 1500 });
    }

    if (solution) {
      const isCorrect = solution[row][col] === num;
      if (isCorrect) {
        toast.success('✅', { duration: 1500, style: { background: 'transparent', boxShadow: 'none' }, icon: null });
      } else {
        toast.error('❌', { duration: 1500, style: { background: 'transparent', boxShadow: 'none' }, icon: null });
      }
    }

    updateCell(row, col, num, userId);
    broadcastMove(row, col, num);
  }, [selectedCell, userId, updateCell, broadcastMove, solution, locks]);


  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Loading room...</div>;
  }

  if (!grid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6 text-center">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Menunggu host memulai room...</h2>
          <p className="text-secondary text-sm">
            Room code: <span className="font-mono">{roomId}</span>
          </p>
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
            <button onClick={copyRoomCode} className="hover:text-foreground transition-colors p-0.5">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs sm:text-sm font-medium">{username}</span>
            <div className="w-7 h-7 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold">
              {username?.charAt(0).toUpperCase()}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)} className="p-1.5 h-8 w-8">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={leaveRoom} className="h-8 px-2.5 text-xs">
            <LogOut className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Leave</span>
          </Button>
        </div>
      </header>

      {/* BANNER 1: Jika ENV Vercel / Supabase Belum Valid */}
      {!isSupabaseEnvValid && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ENV NOT VALID:</strong> Environment Variables Supabase (<code className="bg-red-500/20 px-1 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_URL</code> & <code className="bg-red-500/20 px-1 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) belum dipasang atau masih placeholder di Vercel. Fitur multiplayer realtime mati.
          </span>
        </div>
      )}

      {/* BANNER 2: Jika ENV Valid tapi WebSockets Supabase Offline / Channel Error */}
      {isSupabaseEnvValid && (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT' || connectionError) && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ROOM OFFLINE:</strong> {connectionError || `Koneksi WebSocket gagal (${realtimeStatus})`}. Pastikan fitur Realtime di Dashboard Supabase telah diaktifkan.
          </span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Sidebar Left: Players & Chat */}
        <div className="space-y-4 flex flex-col h-full lg:col-span-2">
          <Card className="flex-shrink-0 flex flex-col overflow-hidden min-h-[250px] lg:min-h-0 lg:flex-1">
            <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Users className="w-4 h-4" /> Players
              </h2>
              <span className="text-xs text-secondary bg-secondary/10 px-2 py-0.5 rounded-full">
                {Object.keys(room?.players || {}).length} / {room?.maxPlayers || 4}
              </span>
            </div>
            <div className="p-3 overflow-y-auto flex-1 space-y-2 text-xs sm:text-sm">
              {Object.values(room?.players || {}).map(player => (
                <div key={player.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: player.color }}
                    />
                    <span className="font-medium">
                      {player.username} {player.isHost && <span className="text-secondary">(Host)</span>}
                    </span>
                  </div>
                  <span className="font-mono">{player.score}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex-shrink-0 flex flex-col overflow-hidden min-h-[250px] lg:min-h-0 lg:flex-1">
            <div className="p-3 border-b border-border bg-background/50">
              <h2 className="font-semibold text-sm">Chat</h2>
            </div>
            <div className="flex-1 p-3 flex flex-col overflow-y-auto space-y-2 text-xs sm:text-sm">
              {messages.length === 0 ? (
                <div className="text-secondary italic text-center my-auto">No messages yet.</div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className="flex flex-col">
                    <span className="font-semibold text-[11px] text-secondary">{msg.username}</span>
                    <span className="bg-secondary/10 px-2.5 py-1 rounded-md w-fit max-w-full break-words text-xs">{msg.text}</span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="p-2.5 border-t border-border">
              <form onSubmit={handleChatSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                />
                <Button type="submit" size="sm" className="h-8 px-3 text-xs">
                  Send
                </Button>
              </form>
            </div>
          </Card>
        </div>

        {/* Center: Game Board */}
        <div className="lg:col-span-3 flex flex-col items-center justify-center">
          <div className="w-full max-w-2xl flex flex-col items-center gap-6">
            <div className="w-full flex justify-between items-end">
              <div>
                <h2 className="text-2xl font-bold">{room?.difficulty?.toUpperCase() || 'MEDIUM'}</h2>
                <p className="text-secondary text-sm">Mode: {room?.mode || 'collaborative'}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-mono">{formatTime(elapsedTime)}</div>
                <p className="text-secondary text-sm">Timer</p>
              </div>
            </div>

            <SudokuBoard
              broadcastMove={broadcastMove}
              broadcastCursor={broadcastCursor}
              lockCell={lockCell}
              locks={locks}
            />

            {/* Controls */}
            <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex gap-2">

                <Button variant="outline" size="sm" onClick={handleHint} disabled={hintsRemaining <= 0}>
                  <Lightbulb className="w-4 h-4 mr-2" /> Hint ({hintsRemaining})
                </Button>

              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {/* Number Pad for Mobile/Mouse users */}
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <button
                    key={n}
                    onClick={() => handleNumpadClick(n)}
                    className="w-10 h-10 rounded-lg border border-border bg-card hover:bg-hover font-semibold text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-foreground"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Settings">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tema Gelap (Dark Mode)</span>
            <Button variant="outline" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? 'Aktif' : 'Nonaktif'}
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
