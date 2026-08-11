"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore } from '../../../store/gameStore';
import { useRealtime } from '../../../hooks/useRealtime';
import { getOrCreateUserId } from '../../../utils/uuid';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { SudokuBoard } from '../../../components/game/SudokuBoard';
import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, AlertTriangle, WifiOff, Edit2, Eraser, MessageCircle, ArrowLeft, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import { isSupabaseEnvValid } from '../../../services/supabase';
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
  const setGameData = useGameStore(state => state.setGameData);
  const setUserInfo = useGameStore(state => state.setUserInfo);
  const selectedCell = useGameStore(state => state.selectedCell);
  const messages = useGameStore(state => state.messages);
  const player = useGameStore(state => state.room?.players[userId || '']);
  const hintsRemaining = player?.hints ?? 3;
  const isSpectator = Boolean(player?.isSpectator);

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isPencilMode, setIsPencilMode] = useState(false);
  const [isEraserMode, setIsEraserMode] = useState(false);

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
    setTimeout(() => setTheme(storedTheme), 0);
    applyTheme(storedTheme);
  }, [applyTheme]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('sudoku_theme', newTheme);
    applyTheme(newTheme);
  };

  const { broadcastMove, broadcastNote, broadcastCursor, lockCell, locks, broadcastChat, broadcastNextGame, realtimeStatus, connectionError } = useRealtime(roomId);
  const [chatInput, setChatInput] = useState('');

  const isGameCompleted = React.useMemo(() => {
    if (!grid) return false;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = grid[r][c];
        if (cell.value === null || cell.isConflicting || cell.isWrong) return false;
      }
    }
    return true;
  }, [grid]);

  // Otomatis minta soal unik jika mode Competition dan papan pemain masih kosong
  useEffect(() => {
    if (room && room.mode === 'competition' && !grid && !loading) {
      fetch('/api/game/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: room.difficulty })
      })
      .then(res => res.json())
      .then(data => {
        if (data.initialGrid && data.solutionToken) {
          setGameData(data.initialGrid, data.solutionToken);
        }
      })
      .catch(err => console.error('Failed to fetch competition puzzle:', err));
    }
  }, [room, grid, loading, setGameData]);

  const handleNextGame = async () => {
    if (!room) return;
    try {
      toast.loading('Mempersiapkan game baru...', { id: 'nextGame' });
      if (room.mode === 'competition') {
        broadcastNextGame(null, null);
        const res = await fetch('/api/game/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: room.difficulty })
        });
        const data = await res.json();
        if (res.ok && data.initialGrid && data.solutionToken) {
          useGameStore.getState().startNextGame(data.initialGrid, data.solutionToken);
          toast.success('Game baru dimulai!', { id: 'nextGame' });
        } else {
          toast.error('Gagal membuat game baru', { id: 'nextGame' });
        }
      } else {
        const res = await fetch('/api/game/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: room.difficulty })
        });
        const data = await res.json();
        if (res.ok && data.initialGrid && data.solutionToken) {
          broadcastNextGame(data.initialGrid, data.solutionToken);
          toast.success('Game baru dimulai!', { id: 'nextGame' });
        } else {
          toast.error('Gagal membuat game baru', { id: 'nextGame' });
        }
      }
    } catch {
      toast.error('Gagal membuat game baru', { id: 'nextGame' });
    }
  };

  const [newMsgNotif, setNewMsgNotif] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chatContainer = chatEndRef.current?.parentElement;
    if (chatContainer) {
      const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 150;
      if (isNearBottom) {
        requestAnimationFrame(() => {
          chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });
      }
    } else {
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }

    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.userId !== userId) {
        setTimeout(() => setNewMsgNotif(true), 0);
        const timer = setTimeout(() => setNewMsgNotif(false), 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [messages, userId]);

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
      if (textarea) textarea.style.height = '40px';

      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }
  };

  useEffect(() => {
    if (!roomId) return;

    const storedUserId = getOrCreateUserId();
    const storedUsername = typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') : null;

    if (!storedUserId || !storedUsername) {
      router.push('/');
      return;
    }

    if (!userId) {
      setUserInfo(storedUserId, storedUsername);
    }

    enterRoom(roomId);

    let isHostFromConfig = false;
    let difficulty: Difficulty = 'medium';
    let mode: GameMode = 'collaborative';
    let maxPlayers = 4;

    const roomConfigStr = sessionStorage.getItem(`sudoku_room_config_${roomId}`);
    if (roomConfigStr) {
      try {
        const config = JSON.parse(roomConfigStr);
        isHostFromConfig = Boolean(config.isHost);
        if (isHostFromConfig) {
          difficulty = (config.difficulty as Difficulty) || 'medium';
          mode = (config.mode as GameMode) || 'collaborative';
          maxPlayers = config.maxPlayers || 4;
        }
      } catch (error) {
        console.error('Failed to parse room config', error);
      }
    }

    const currentState = useGameStore.getState();
    const existingRoom = currentState.room;

    const isHostFromStorage = existingRoom?.hostId === storedUserId;
    const isHostFromSession = sessionStorage.getItem(`sudoku_host_room_${roomId}`) === '1';
    const isHost = isHostFromConfig || isHostFromStorage || isHostFromSession;

    if (!existingRoom && isHost) {
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

      fetch('/api/game/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      })
      .then(res => res.json())
      .then(data => {
        if (data.initialGrid && data.solutionToken) {
          currentState.setGameData(data.initialGrid, data.solutionToken);
        }
      })
      .catch(err => console.error('Failed to initialize room data:', err));
    }

    const t = setTimeout(() => setLoading(false), 0);
    return () => clearTimeout(t);
  }, [roomId, router, userId, room, setGameData, setUserInfo, enterRoom]);

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

  const handleHint = useCallback(async () => {
    if (isSpectator) return;
    if (!userId) return;

    if (!selectedCell) {
      toast.error('Pilih kotak terlebih dahulu untuk menggunakan hint!');
      return;
    }

    const store = useGameStore.getState();
    const player = store.room?.players[userId];
    if (!player) return;

    if (player.hints <= 0) {
      toast.error('Jatah hint kamu sudah habis!');
      return;
    }

    const currentCell = store.grid?.[selectedCell.row]?.[selectedCell.col];
    if (!currentCell) return;

    // Jika sel merupakan soal awal yang sudah dikunci
    if (currentCell.isLocked) {
      toast('Jawaban sudah benar', { icon: '✅' });
      return;
    }

    if (!store.solutionToken) {
      toast.error('Token room tidak ditemukan.');
      return;
    }

    try {
      const res = await fetch('/api/game/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row: selectedCell.row,
          col: selectedCell.col,
          solutionToken: store.solutionToken,
        }),
      });
      const data = await res.json();
      if (data.value !== undefined) {
        // Jika sel sudah terisi jawaban yang benar
        if (currentCell.value !== null && currentCell.value === data.value) {
          toast('Jawaban sudah benar', { icon: '✅' });
          return;
        }

        // Berfungsi untuk kotak kosong (null) atau angka yang salah
        broadcastMove(selectedCell.row, selectedCell.col, data.value);
        store.updatePlayer(userId, { hints: player.hints - 1 });
        toast.success('Hint digunakan!');
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch (e) {
      console.error('Gagal mendapatkan hint:', e);
      toast.error('Gagal mengambil hint');
    }
  }, [userId, selectedCell, broadcastMove, isSpectator]);

  const handleArrowNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (isSpectator) return;
    const current = selectedCell || { row: 0, col: 0 };
    let newRow = current.row;
    let newCol = current.col;

    if (direction === 'up') newRow = Math.max(0, current.row - 1);
    if (direction === 'down') newRow = Math.min(8, current.row + 1);
    if (direction === 'left') newCol = Math.max(0, current.col - 1);
    if (direction === 'right') newCol = Math.min(8, current.col + 1);

    useGameStore.getState().setSelectedCell({ row: newRow, col: newCol });
    if (room?.mode !== 'competition') {
      broadcastCursor(newRow, newCol);
      lockCell(newRow, newCol);
    }
  }, [selectedCell, broadcastCursor, lockCell, isSpectator, room?.mode]);

  const handleNumpadClick = useCallback((num: number) => {
    if (isSpectator || !selectedCell || !userId) return;
    const { row, col } = selectedCell;
    const key = `${row}-${col}`;
    const currentLock = locks[key];

    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) return;

    const currentGrid = useGameStore.getState().grid;
    if (currentGrid && currentGrid[row][col].isLocked) return;

    if (isEraserMode && currentGrid && currentGrid[row][col].value === null) {
      if (currentGrid[row][col].notes.includes(num)) broadcastNote(row, col, num);
    } else if (!isSpectator && isPencilMode && currentGrid && currentGrid[row][col].value === null) {
      broadcastNote(row, col, num);
    } else if (!isSpectator) {
      broadcastMove(row, col, num);
    }
  }, [selectedCell, userId, broadcastMove, broadcastNote, locks, isPencilMode, isEraserMode, isSpectator]);

  const handleEraserClick = useCallback(() => {
    if (isSpectator) return;
    setIsEraserMode(!isEraserMode);
    setIsPencilMode(false);

    if (!selectedCell || !userId) return;
    const { row, col } = selectedCell;
    const key = `${row}-${col}`;
    const currentLock = locks[key];

    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) return;

    const currentGrid = useGameStore.getState().grid;
    if (currentGrid && currentGrid[row][col].isLocked) return;

    if (currentGrid && currentGrid[row][col].value !== null) {
      broadcastMove(row, col, null);
    }
  }, [isEraserMode, selectedCell, userId, broadcastMove, locks, isSpectator]);

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

      {/* BANNER STATUS KONEKSI */}
      {!isSupabaseEnvValid && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ENV NOT VALID:</strong> Environment Variables Supabase belum dipasang. Fitur multiplayer realtime mati.
          </span>
        </div>
      )}

      {isSupabaseEnvValid && (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT' || connectionError) && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ROOM OFFLINE:</strong> {connectionError || `Koneksi WebSocket gagal (${realtimeStatus})`}.
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
                      className={`w-2.5 h-2.5 rounded-full ${player.status === 'offline' ? 'opacity-40' : ''}`}
                      style={{ backgroundColor: player.color }}
                    />
                    <span className={`font-medium ${player.status === 'offline' ? 'line-through text-secondary/60' : ''}`}>
                      {player.username}
                    </span>
                    {player.status === 'offline' ? (
                      <span className="text-red-500 font-semibold text-[11px] bg-red-500/10 px-1.5 py-0.5 rounded">
                        ( Leave Room )
                      </span>
                    ) : player.isHost ? (
                      <span className="text-secondary text-xs">(Host)</span>
                    ) : null}
                  </div>
                  <span className="font-mono font-bold">
                    {room?.mode === 'competition' ? (
                      player.rank && player.rank > 0 ? (
                        player.rank === 1 ? '🥇 1' :
                        player.rank === 2 ? '🥈 2' :
                        player.rank === 3 ? '🥉 3' : '' // Juara 4+ disembunyikan tanpa medali
                      ) : (
                        `${player.progress ?? 0}%`
                      )
                    ) : (
                      player.score
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex-shrink-0 flex flex-col overflow-hidden h-[380px] w-full">
            <div className="p-3 border-b border-border bg-background/50 flex-shrink-0">
              <h2 className="font-semibold text-sm flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> Chat
                </div>
                {newMsgNotif && (
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full animate-pulse transition-opacity duration-300 flex items-center gap-1 shadow-sm">
                    ✉️ +1
                  </span>
                )}
              </h2>
            </div>
            <div className="flex-1 p-3 flex flex-col overflow-y-auto space-y-2 text-xs sm:text-sm min-h-0">
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
            <div className="p-2.5 border-t border-border flex-shrink-0">
              <form onSubmit={handleChatSubmit} className="flex items-center gap-2">
                <textarea
                  id="chat-textarea"
                  value={chatInput}
                  onChange={e => {
                    setChatInput(e.target.value);
                    e.target.style.height = '40px';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder="Type a message..."
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-foreground resize-none min-h-[40px] max-h-[120px] overflow-y-auto"
                  rows={1}
                />
                <Button type="submit" size="sm" className="h-8 px-3 text-xs flex-shrink-0">
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
                {isGameCompleted && player?.isHost && (
                  <Button onClick={handleNextGame} className="mt-2 bg-green-600 hover:bg-green-700 text-white">
                    Next Game
                  </Button>
                )}
                {isGameCompleted && !player?.isHost && (
                  <div className="mt-2 text-sm text-green-500 font-medium animate-pulse">
                    Game selesai! Menunggu host...
                  </div>
                )}
                <p className="text-secondary text-sm">Mode: {room?.mode || 'collaborative'}</p>
              </div>
            </div>

            <SudokuBoard
              broadcastMove={broadcastMove}
              broadcastNote={broadcastNote}
              broadcastCursor={broadcastCursor}
              lockCell={lockCell}
              locks={locks}
              isPencilMode={isPencilMode}
              isEraserMode={isEraserMode}
            />

            <div className="flex flex-col items-center">
              <div className="text-2xl font-mono">{formatTime(elapsedTime)}</div>
              <p className="text-secondary text-sm">Timer</p>
            </div>

            {/* Controls */}
            <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleHint} disabled={hintsRemaining <= 0 || isSpectator}>
                  <Lightbulb className="w-4 h-4 mr-2" /> Hint ({hintsRemaining})
                </Button>
                <Button variant={isPencilMode ? "primary" : "outline"} size="sm" onClick={() => { setIsPencilMode(!isPencilMode); setIsEraserMode(false); }}>
                  <Edit2 className="w-4 h-4 mr-2" /> Note
                </Button>
                <Button variant={isEraserMode ? "primary" : "outline"} size="sm" onClick={handleEraserClick}>
                  <Eraser className="w-4 h-4 mr-2" /> Eraser
                </Button>
              </div>

              {/* TOMBOL NAVIGASI PANAH */}
              <div className="flex items-center gap-2 bg-card p-1.5 rounded-xl border border-border mt-2">
                <span className="text-xs text-secondary font-medium px-1">Navigasi:</span>
                <Button variant="outline" size="sm" className="w-8 h-8 p-0" onClick={() => handleArrowNavigate('left')} disabled={isSpectator}>
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" className="w-8 h-8 p-0" onClick={() => handleArrowNavigate('up')} disabled={isSpectator}>
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" className="w-8 h-8 p-0" onClick={() => handleArrowNavigate('down')} disabled={isSpectator}>
                  <ArrowDown className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" className="w-8 h-8 p-0" onClick={() => handleArrowNavigate('right')} disabled={isSpectator}>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-2">
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <button
                    key={n}
                    onClick={() => handleNumpadClick(n)}
                    disabled={isSpectator}
                    className="w-10 h-10 rounded-lg border border-border bg-card hover:bg-hover font-semibold text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
