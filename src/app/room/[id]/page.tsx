"use client";

import { generateInitialSnakesState } from "../../../utils/snakesAndLaddersData";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore } from '../../../store/gameStore';
import { useRealtime } from '../../../hooks/useRealtime';
import { getOrCreateUserId } from '../../../utils/uuid';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { ProfileWidget } from '../../../components/profile/ProfileWidget';
import { ErrorLogPanel } from '../../../components/admin/ErrorLogPanel';
import { OnlinePlayersBox } from '../../../components/online/OnlinePlayersBox';
import { initErrorLogger } from '../../../utils/errorLogger';
import { SudokuBoard } from '../../../components/game/SudokuBoard';
import { SudokuBoard3D } from '../../../components/game/SudokuBoard3D';
import { SnakesAndLaddersBoard } from '../../../components/game/SnakesAndLaddersBoard';
import {
  Copy,
  Users,
  Settings,
  LogOut,
  CheckCircle2,
  Lightbulb,
  AlertTriangle,
  WifiOff,
  Edit2,
  Eraser,
  MessageCircle,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  RotateCw,
  Box,
  Grid as GridIcon
} from 'lucide-react';
import { isSupabaseEnvValid } from '../../../services/supabase';
import { getStoredAvatar } from '../../../utils/avatar';
import { Difficulty, GameMode, RoomState, Player } from '../../../types/game';
import toast from 'react-hot-toast';

export default function RoomPage() {
  const params = useParams();
  const roomId = (params?.id as string) || '';
  const router = useRouter();

  const userId = useGameStore(state => state.userId);
  const username = useGameStore(state => state.username);
  const room = useGameStore(state => state.room);
  const grid = useGameStore(state => state.grid);
  const resetGame = useGameStore(state => state.resetGame);
  const setGameData = useGameStore(state => state.setGameData);
  const selectedCell = useGameStore(state => state.selectedCell);
  const messages = useGameStore(state => state.messages);
  const player = useGameStore(state => state.room?.players[userId || '']);
  const hintsRemaining = player?.hints ?? 3;
  const isSpectator = Boolean(player?.isSpectator);

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  const isInitializedRef = useRef(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isPencilMode, setIsPencilMode] = useState(false);
  const [isEraserMode, setIsEraserMode] = useState(false);

  // Modal Next Game State
  const [isNextGameModalOpen, setIsNextGameModalOpen] = useState(false);
  const [nextGameStep, setNextGameStep] = useState<'confirm' | 'settings'>('confirm');
  const [isApplied, setIsApplied] = useState(false);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');

  const [nextDifficulty, setNextDifficulty] = useState<Difficulty>('medium');
  const [nextMode, setNextMode] = useState<GameMode>('collaborative');
  const [nextMaxPlayers, setNextMaxPlayers] = useState(4);

  // Admin logs gate
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const isAdminUser = (username || '').toUpperCase() === 'ADMIN';

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
    initErrorLogger();
    try {
      const verified = sessionStorage.getItem('sudoku_admin_verified') === '1';
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage to state sync on mount is intentional
      if (verified) setIsAdminVerified(true);
    } catch {}
  }, []);

  useEffect(() => {
    const storedTheme = (localStorage.getItem('sudoku_theme') as 'light' | 'dark' | 'system') || 'system';
    setTimeout(() => setTheme(storedTheme), 0);
    applyTheme(storedTheme);
  }, [applyTheme]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('sudoku_theme', newTheme);
    applyTheme(newTheme);
  };

  const {
    broadcastMove,
    broadcastNote,
    broadcastCursor,
    lockCell,
    locks,
    broadcastChat,
    broadcastNextGame,
    broadcastLeaveRoom,
    broadcastSnakesDiceRoll,
    broadcastSnakesState,
    broadcastAvatarUpdate,
    broadcastProfileUpdate,
    broadcastPlayerStats,
    isTrulyOffline,
    connectionError,
    reconnect
  } = useRealtime(roomId);

  const [chatInput, setChatInput] = useState('');

  const snakesWinners = useGameStore(state => state.snakesState?.winners);
  const snakesWinnerId = useGameStore(state => state.snakesState?.winnerId);

  // Munculkan Next Game jika ada minimal 1 juara (Ular Tangga) atau puzzle selesai (Sudoku)
  const canTriggerNextGame = React.useMemo(() => {
    if (room?.mode === 'snakes_and_ladders') {
      return Boolean((snakesWinners && snakesWinners.length > 0) || snakesWinnerId);
    }
    if (!grid) return false;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = grid[r][c];
        if (cell.value === null || cell.isConflicting || cell.isWrong) return false;
      }
    }
    return true;
  }, [grid, room?.mode, snakesWinners, snakesWinnerId]);

  const solutionToken = useGameStore(state => state.solutionToken);

  const isFetchingPuzzleRef = useRef(false);

  useEffect(() => {
    if (
      room?.mode === "competition" &&
      !grid &&
      !solutionToken &&
      !loading &&
      !isFetchingPuzzleRef.current
    ) {
      isFetchingPuzzleRef.current = true;

      fetch("/api/game/create-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty: room.difficulty || "medium", roomId }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("API Error");
          return res.json();
        })
        .then((data) => {
          if (data.initialGrid && data.solutionToken) {
            setGameData(data.initialGrid, data.solutionToken);
          } else {
            toast.error(data.error || "Gagal memuat puzzle competition");
          }
        })
        .catch((err) => {
          console.error("Failed to fetch competition puzzle:", err);
        })
        .finally(() => {
          isFetchingPuzzleRef.current = false;
        });
    }
  }, [room?.mode, room?.difficulty, grid, solutionToken, loading, setGameData, roomId]);
  const handleOpenNextGameModal = () => {
    if (!room) return;
    setNextDifficulty(room.difficulty || 'medium');
    setNextMode(room.mode || 'collaborative');
    setNextMaxPlayers(room.maxPlayers || 4);
    setNextGameStep('confirm');
    setIsApplied(false);
    setIsNextGameModalOpen(true);
  };

  const executeStartNextGame = async (diff: Difficulty, gameMode: GameMode, maxP: number) => {
    if (!room) return;
    try {
      toast.loading('Mempersiapkan game baru...', { id: 'nextGame' });

      // Reset timer startedAt dan progress setiap player
      const updatedRoom: RoomState = {
        ...room,
        difficulty: diff,
        mode: gameMode,
        maxPlayers: maxP,
        startedAt: Date.now(),
        players: Object.fromEntries(
          Object.entries(room.players).map(([id, p]) => [
            id,
            {
              ...p,
              score: p.score ?? 0, // Skor kemenangan tetap dipertahankan
              hints: 3,
              progress: 0,
              rank: undefined,
              cursor: undefined,
            },
          ])
        ),
      };

      useGameStore.getState().setRoom(updatedRoom);

      // MODE 1: ULAR TANGGA
      if (gameMode === 'snakes_and_ladders') {
        const activeIds = Object.values(updatedRoom.players)
          .filter((p: Player) => !p.isSpectator && p.status !== 'left')
          .map((p: Player) => p.id);

        const newSnakesState = generateInitialSnakesState(diff, activeIds);
        newSnakesState.winners = [];
        newSnakesState.winnerId = null;
        newSnakesState.frozenTurns = {};
        newSnakesState.currentTurnUserId = activeIds[0] || '';
        // generateInitialSnakesState restarts at revision 1 — after a long match the
        // room revision is far higher, so every client would reject it as stale.
        // Always move FORWARD from the current authoritative revision.
        const baseRevision = useGameStore.getState().snakesState?.revision ?? 0;
        newSnakesState.revision = Math.max(newSnakesState.revision ?? 1, baseRevision + 1);

        useGameStore.getState().updateSnakesState(newSnakesState);

        broadcastNextGame(null, null, updatedRoom, newSnakesState);
        toast.success('Game Ular Tangga baru dimulai!', { id: 'nextGame' });
      }
      // MODE 2: SUDOKU COMPETITION
      else if (gameMode === 'competition') {
        broadcastNextGame(null, null, updatedRoom, null);
        const res = await fetch('/api/game/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: diff, roomId }),
        });
        const data = await res.json();
        if (res.ok && data.initialGrid && data.solutionToken) {
          useGameStore.getState().startNextGame(data.initialGrid, data.solutionToken);
          toast.success('Game Sudoku Competition dimulai!', { id: 'nextGame' });
        } else {
          toast.error('Gagal membuat game baru', { id: 'nextGame' });
        }
      }
      // MODE 3: SUDOKU COLLABORATIVE / CLASSIC / RACE / ZEN
      else {
        const res = await fetch('/api/game/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: diff, roomId }),
        });
        const data = await res.json();
        if (res.ok && data.initialGrid && data.solutionToken) {
          useGameStore.getState().startNextGame(data.initialGrid, data.solutionToken);
          broadcastNextGame(data.initialGrid, data.solutionToken, updatedRoom, null);
          toast.success('Game Sudoku baru dimulai!', { id: 'nextGame' });
        } else {
          toast.error('Gagal membuat game baru', { id: 'nextGame' });
        }
      }

      setIsNextGameModalOpen(false);
    } catch {
      toast.error('Gagal membuat game baru', { id: 'nextGame' });
    }
  };

  const [newMsgNotif, setNewMsgNotif] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef<number>(0);
  const joinTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (joinTimestampRef.current === 0) {
      joinTimestampRef.current = Date.now();
    }
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      const el = chatContainerRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }

    if (messages.length > prevMsgCountRef.current) {
      if (prevMsgCountRef.current > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.userId !== userId && lastMsg.timestamp >= joinTimestampRef.current) {
          setTimeout(() => setNewMsgNotif(true), 0);
          const timer = setTimeout(() => setNewMsgNotif(false), 2000);
          prevMsgCountRef.current = messages.length;
          return () => clearTimeout(timer);
        }
      }
      prevMsgCountRef.current = messages.length;
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

      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }
  };

  useEffect(() => {
    if (!roomId || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const storedUserId = getOrCreateUserId();
    let storedUsername = typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') : null;
    // Pastikan selalu kapital (fix bug TES1 / huruf kecil)
    if (storedUsername) {
      const upper = storedUsername.toUpperCase();
      if (upper !== storedUsername) {
        try { localStorage.setItem('sudoku_username', upper); } catch {}
        storedUsername = upper;
      }
    }

    // Empty name ("") is valid — only redirect when the key was never set.
    if (!storedUserId || storedUsername === null) {
      router.push('/');
      return;
    }

    useGameStore.getState().setUserInfo(storedUserId, storedUsername);
    useGameStore.getState().enterRoom(roomId);

    let difficulty: Difficulty = 'medium';
    let mode: GameMode = 'collaborative';
    let maxPlayers = 4;
    let isHost = sessionStorage.getItem(`sudoku_host_room_${roomId}`) === '1';

    const roomConfigStr = sessionStorage.getItem(`sudoku_room_config_${roomId}`);
    if (roomConfigStr) {
      try {
        const config = JSON.parse(roomConfigStr);
        if (config.isHost) {
          isHost = true;
          difficulty = (config.difficulty as Difficulty) || 'medium';
          mode = (config.mode as GameMode) || 'collaborative';
          maxPlayers = config.maxPlayers || 4;
        }
      } catch (e) {
        console.error('Error parsing room config:', e);
      }
    }

    if (isHost) {
      const hostAvatar = getStoredAvatar();
      useGameStore.getState().setRoom({
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
            avatar: hostAvatar,
          },
        },
        createdAt: Date.now(),
        startedAt: Date.now(),
      });

      if (mode === 'snakes_and_ladders') {
        const initialSnakes = generateInitialSnakesState(difficulty, [storedUserId]);
        useGameStore.getState().replaceAllSnakesState(initialSnakes);
        setLoading(false);
      } else {
        fetch('/api/game/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty, roomId }),
        })
          .then((res) => {
            if (!res.ok) throw new Error('API Error');
            return res.json();
          })
          .then((data) => {
            if (data.initialGrid && data.solutionToken) {
              useGameStore.getState().setGameData(data.initialGrid, data.solutionToken);
            } else {
              toast.error(data.error || 'Gagal memuat puzzle');
            }
          })
          .catch((err) => {
            console.error('[Room Init] Gagal membuat game:', err);
            toast.error('Gagal memuat puzzle. Pastikan SERVER berjalan normal.');
          })
          .finally(() => {
            setLoading(false);
          });
      }
    } else {
      setTimeout(() => setLoading(false), 0);
    }
  }, [roomId, router]);

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
    } catch (err) {
      console.warn('Leave room non-blocking error:', err);
    } finally {
      sessionStorage.removeItem(`sudoku_host_room_${roomId}`);
      sessionStorage.removeItem(`sudoku_room_config_${roomId}`);
      resetGame();
      try {
        useGameStore.getState().clearPersistedStorage();
      } catch {}
      router.replace('/');
    }
  };

  const handleAutoNote = useCallback(() => {
    if (isSpectator) return;
    const store = useGameStore.getState();
    if (!store.grid) return;
    store.autoNote();
    toast.success('Auto Note applied!', { duration: 1500 });
  }, [isSpectator]);

  const handleHint = useCallback(async () => {
    if (isSpectator || !userId) return;

    if (!selectedCell) {
      toast.error('Pilih kotak terlebih dahulu untuk menggunakan hint!');
      return;
    }

    const store = useGameStore.getState();
    const p = store.room?.players[userId];
    if (!p) return;

    if (store.room?.mode !== 'zen' && p.hints <= 0) {
      toast.error('Jatah hint kamu sudah habis!');
      return;
    }

    const currentCell = store.grid?.[selectedCell.row]?.[selectedCell.col];
    if (!currentCell) return;

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
          roomId,
        }),
      });
      const data = await res.json();
      if (data.value !== undefined) {
        if (currentCell.value !== null && currentCell.value === data.value) {
          toast('Jawaban sudah benar', { icon: '✅' });
          return;
        }

        broadcastMove(selectedCell.row, selectedCell.col, data.value);
        store.updatePlayer(userId, { hints: p.hints - 1 });
        toast.success('Hint digunakan!');
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch (e) {
      console.error('Gagal mendapatkan hint:', e);
      toast.error('Gagal mengambil hint');
    }
  }, [userId, selectedCell, broadcastMove, isSpectator, roomId]);

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

  // Tampilan Menunggu Host dengan opsi sinkronisasi ulang
  if (!grid && room?.mode !== 'snakes_and_ladders') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6 text-center space-y-4">
        <div className="space-y-2">
          <div className="w-10 h-10 border-3 border-foreground border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold">Menghubungkan ke Papan Game...</h2>
          <p className="text-secondary text-sm">
            Menyinkronkan data puzzle dari host untuk room <span className="font-mono font-semibold text-foreground">{roomId}</span>
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              reconnect();
              toast.success('Meminta ulang data puzzle...');
            }}
          >
            <RotateCw className="w-4 h-4 mr-2" /> Sinkronkan Ulang
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={leaveRoom}
            className="text-red-500 hover:bg-red-500/10"
          >
            <LogOut className="w-4 h-4 mr-2" /> Keluar
          </Button>
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

        <div className="flex items-center gap-1.5 sm:gap-2">
          {isAdminUser && isAdminVerified && <ErrorLogPanel isAdmin={true} />}
          {/* Profile (avatar + nama) tetap terlihat selama game, realtime tanpa reset */}
          <ProfileWidget onAvatarUpdate={broadcastAvatarUpdate} onProfileUpdate={broadcastProfileUpdate} compact />
          <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)} className="p-1.5 h-8 w-8">
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
            <span className="hidden sm:inline">
              {isLeaving ? 'Leaving...' : 'Leave'}
            </span>
          </Button>
        </div>
      </header>

      {/* BANNER STATUS KONEKSI */}
      {!isSupabaseEnvValid && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center transition-all duration-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ENV NOT VALID:</strong> Environment Variables Supabase belum dipasang. Fitur multiplayer realtime mati.
          </span>
        </div>
      )}

      {/* BANNER OFFLINE STABIL */}
      {isSupabaseEnvValid && isTrulyOffline && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center transition-all duration-300">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>KONEKSI TERPUTUS:</strong> {connectionError || 'Tidak dapat terhubung ke server.'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reconnect()}
            className="h-7 px-2.5 text-xs border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 ml-2"
          >
            Hubungkan Ulang
          </Button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Sidebar Left: Players & Chat */}
        <div className="space-y-4 flex flex-col h-full lg:col-span-2">
          {/* Player Online — realtime, bisa invite */}
          <OnlinePlayersBox variant="room" roomId={roomId} />

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
              {Object.values(room?.players || {}).map(p => (
                <div key={p.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar} alt={p.username} className="w-6 h-6 rounded-full object-cover border border-border shrink-0" />
                    ) : (
                      <div className={`w-2.5 h-2.5 rounded-full ${p.status !== 'online' ? 'opacity-40' : ''} shrink-0`} style={{ backgroundColor: p.status === 'online' ? p.color : '#9ca3af' }} />
                    )}
                    <span className={`font-medium ${p.status !== 'online' ? 'line-through text-secondary/60' : ''}`}>
                      {p.username}
                    </span>
                    {p.isHost && (
                      <span className="text-secondary text-xs">(Host)</span>
                    )}
                    {p.status === 'left' ? (
                      <span className="text-red-500 font-semibold text-[11px] bg-red-500/10 px-1.5 py-0.5 rounded">
                        ( Leave Room )
                      </span>
                    ) : p.status === 'disconnected' || p.status === 'offline' ? (
                      <span className="text-amber-500 font-semibold text-[11px] bg-amber-500/10 px-1.5 py-0.5 rounded">
                        ( Disconnect )
                      </span>
                    ) : null}
                    {room?.mode === 'race' && (p.streak ?? 0) > 1 && (
                      <span className="text-orange-500 font-bold text-[11px] bg-orange-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                        🔥 x{p.streak}
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold">
                    {p.rank && p.rank > 0 ? (
                      p.rank === 1 ? '🥇 1' :
                      p.rank === 2 ? '🥈 2' :
                      p.rank === 3 ? '🥉 3' : ''
                    ) : room?.mode === 'competition' ? (
                      // Competition cukup tampilkan persentase progress (3% … 100%)
                      `${p.progress ?? 0}%`
                    ) : (
                      p.score
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
                  <span className="text-xs bg-foreground text-background font-semibold px-2 py-0.5 rounded-full animate-pulse transition-opacity duration-300 flex items-center gap-1 shadow-sm">
                    ✉️ +1
                  </span>
                )}
              </h2>
            </div>
            <div ref={chatContainerRef}
              className="flex-1 p-3 flex flex-col overflow-y-auto space-y-2 text-xs sm:text-sm min-h-0">
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
                {canTriggerNextGame && player?.isHost && (
                  <Button onClick={handleOpenNextGameModal} className="mt-2 bg-green-600 hover:bg-green-700 text-white shadow-md">
                    Next Game
                  </Button>
                )}
                {canTriggerNextGame && !player?.isHost && (
                  <div className="mt-2 text-sm text-green-500 font-medium">
                    {room?.mode === 'snakes_and_ladders' && (snakesWinners?.length ?? 0) > 0
                      ? `Juara 1 telah keluar! Menunggu host untuk Next Game...`
                      : `Game selesai! Menunggu host...`}
                  </div>
                )}
                <p className="text-secondary text-sm">Mode: {room?.mode || 'collaborative'}</p>
              </div>

              {/* Toggle Switch 2D / 3D */}
              <div className="flex items-center bg-card border border-border p-1 rounded-xl gap-1 shadow-sm">
                <button
                  onClick={() => setViewMode('2D')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    viewMode === '2D' || room?.mode === 'snakes_and_ladders'
                      ? 'bg-foreground text-background shadow-xs'
                      : 'text-secondary hover:text-foreground'
                  }`}
                >
                  <GridIcon className="w-3.5 h-3.5" /> 2D
                </button>

                <button
                  onClick={() => {
                    if (room?.mode !== 'snakes_and_ladders') {
                      setViewMode('3D');
                    }
                  }}
                  disabled={room?.mode === 'snakes_and_ladders'}
                  title={room?.mode === 'snakes_and_ladders' ? 'Mode 3D Ular Tangga belum tersedia' : 'Mode 3D'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    viewMode === '3D' && room?.mode !== 'snakes_and_ladders'
                      ? 'bg-foreground text-background shadow-xs'
                      : 'text-secondary hover:text-foreground'
                  } ${room?.mode === 'snakes_and_ladders' ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <Box className="w-3.5 h-3.5" /> 3D
                </button>
              </div>
            </div>

            {/* Render Sesuai Mode Pilihan */}
            {room?.mode === 'snakes_and_ladders' ? (
              <SnakesAndLaddersBoard broadcastSnakesState={broadcastSnakesState} broadcastSnakesDiceRoll={broadcastSnakesDiceRoll} broadcastPlayerStats={broadcastPlayerStats} />
            ) : viewMode === '3D' ? (
              <SudokuBoard3D
                broadcastMove={broadcastMove}
                broadcastNote={broadcastNote}
                broadcastCursor={broadcastCursor}
                lockCell={lockCell}
                locks={locks}
                isPencilMode={isPencilMode}
                isEraserMode={isEraserMode}
              />
            ) : (
              <SudokuBoard
                broadcastMove={broadcastMove}
                broadcastNote={broadcastNote}
                broadcastCursor={broadcastCursor}
                lockCell={lockCell}
                locks={locks}
                isPencilMode={isPencilMode}
                isEraserMode={isEraserMode}
              />
            )}

            <div className="flex flex-col items-center">
              <div className="text-2xl font-mono">{formatTime(elapsedTime)}</div>
              <p className="text-secondary text-sm">Timer</p>
            </div>

            {/* CONTROLS (Hanya Ditampilkan Pada Mode Sudoku) */}
            {room?.mode !== 'snakes_and_ladders' && (
              <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleHint} disabled={(room?.mode !== 'zen' && hintsRemaining <= 0) || isSpectator}>
                    <Lightbulb className="w-4 h-4 mr-2" /> Hint {room?.mode === 'zen' ? '(∞)' : `(${hintsRemaining})`}
                  </Button>
                  <Button variant={isPencilMode ? "primary" : "outline"} size="sm" onClick={() => { setIsPencilMode(!isPencilMode); setIsEraserMode(false); }}>
                    <Edit2 className="w-4 h-4 mr-2" /> Note
                  </Button>
                  {room?.mode === 'zen' && (
                    <Button variant="outline" size="sm" onClick={handleAutoNote} disabled={isSpectator}>
                      <Lightbulb className="w-4 h-4 mr-2" /> Auto Note
                    </Button>
                  )}
                  <Button variant={isEraserMode ? "primary" : "outline"} size="sm" onClick={handleEraserClick}>
                    <Eraser className="w-4 h-4 mr-2" /> Eraser
                  </Button>
                </div>

                {/* NAVIGASI PANAH */}
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

                {/* NUMPAD ANGKA */}
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {[1,2,3,4,5,6,7,8,9].map(n => (
                    <button
                      key={n}
                      onClick={() => handleNumpadClick(n)}
                      disabled={isSpectator}
                      className="w-10 h-10 rounded-lg border border-border bg-card hover:bg-hover font-semibold text-lg transition-colors focus:outline-none focus:ring-2 focus:ring-foreground disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Settings Modal */}
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

      {/* Next Game Modal for Host */}
      <Modal
        isOpen={isNextGameModalOpen}
        onClose={() => setIsNextGameModalOpen(false)}
        title="Game Berikutnya"
      >
        {nextGameStep === 'confirm' ? (
          <div className="space-y-6 text-center">
            <p className="text-sm text-foreground">
              Lanjut permainan tanpa ada perubahan?
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                fullWidth
                onClick={() => {
                  if (room) {
                    executeStartNextGame(room.difficulty, room.mode, room.maxPlayers);
                  }
                }}
              >
                Yes
              </Button>
              <Button
                variant="outline"
                fullWidth
                onClick={() => {
                  setNextGameStep('settings');
                  setIsApplied(false);
                }}
              >
                No
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-secondary mb-2">
              Pilih opsi pengaturan permainan yang ingin diubah:
            </p>
            <div>
              <label className="text-sm font-medium block mb-1.5">Kesulitan (Difficulty)</label>
              <select
                value={nextDifficulty}
                onChange={(e) => {
                  setNextDifficulty(e.target.value as Difficulty);
                  setIsApplied(false);
                }}
                className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground"
              >
                <option value="easy">Easy (Mudah)</option>
                <option value="medium">Medium (Sedang)</option>
                <option value="hard">Hard (Sulit)</option>
                <option value="expert">Expert (Pakar)</option>
                <option value="evil">Evil (Ekstrem)</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">Mode Permainan</label>
              <select
                value={nextMode}
                onChange={(e) => {
                  setNextMode(e.target.value as GameMode);
                  setIsApplied(false);
                }}
                className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground"
              >
                <option value="collaborative">Collaborative (Kerjasama)</option>
                <option value="competition">Competition (Persaingan)</option>
                <option value="classic">Classic (Klasik)</option>
                <option value="race">Race (Balapan Skor)</option>
                <option value="zen">Zen (Santai)</option>
                <option value="snakes_and_ladders">Snakes & Ladders (Ular Tangga)</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">Maksimal Pemain</label>
              <select
                value={nextMaxPlayers}
                onChange={(e) => {
                  setNextMaxPlayers(Number(e.target.value));
                  setIsApplied(false);
                }}
                className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground"
              >
                <option value={2}>2 Pemain</option>
                <option value={4}>4 Pemain</option>
                <option value={6}>6 Pemain</option>
                <option value={8}>8 Pemain</option>
              </select>
            </div>

            <div className="pt-4 flex gap-2">
              <Button
                variant="outline"
                onClick={() => setNextGameStep('confirm')}
                className="w-1/3"
              >
                Kembali
              </Button>
              {!isApplied ? (
                <Button
                  className="flex-1"
                  onClick={() => {
                    setIsApplied(true);
                    toast.success('Pengaturan diterapkan! Klik Next Game untuk memulai.');
                  }}
                >
                  Apply
                </Button>
              ) : (
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => executeStartNextGame(nextDifficulty, nextMode, nextMaxPlayers)}
                >
                  Next Game
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
