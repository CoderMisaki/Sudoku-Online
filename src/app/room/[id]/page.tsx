"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useGameStore } from '../../../store/gameStore';
import { useRealtime } from '../../../hooks/useRealtime';
import { generatePuzzle } from '../../../utils/sudoku';
import { getOrCreateUserId } from '../../../utils/uuid';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Modal } from '../../../components/ui/Modal';
import { SudokuBoard } from '../../../components/game/SudokuBoard';
import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb } from 'lucide-react';
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
  const setGameData = useGameStore(state => state.setGameData);
  const setUserInfo = useGameStore(state => state.setUserInfo);
  const updateCell = useGameStore(state => state.updateCell);
  const solution = useGameStore(state => state.solution);
  const selectedCell = useGameStore(state => state.selectedCell);
  const player = useGameStore(state => state.room?.players[userId || '']);
  const hintsRemaining = player?.hints ?? 3;

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { broadcastMove, broadcastCursor, lockCell, locks, messages, broadcastChat } = useRealtime(roomId);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      broadcastChat(chatInput.trim());
      setChatInput('');
    }
  };

  // Initialize Realtime


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

    const tempConfigStr = sessionStorage.getItem('temp_room_config');
    let isHost = false;
    let difficulty: Difficulty = 'medium';
    let mode: GameMode = 'collaborative';
    let maxPlayers = 4;

    if (tempConfigStr) {
      try {
        const config = JSON.parse(tempConfigStr);
        isHost = config.isHost;
        if (isHost) {
          difficulty = (config.difficulty as Difficulty) || 'medium';
          mode = (config.mode as GameMode) || 'collaborative';
          maxPlayers = config.maxPlayers || 4;
        }
      } catch (e) {
        console.error('Failed to parse temp_room_config', e);
      }
      sessionStorage.removeItem('temp_room_config');
    }

    // Initialize room state safely if not present
    if (!room && isHost) {
      const { initialGrid, solutionGrid } = generatePuzzle(difficulty);

      setRoom({
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
            status: 'online'
          }
        },
        createdAt: Date.now(),
        startedAt: Date.now()
      });
      setGameData(initialGrid, solutionGrid);
    }

    const t = setTimeout(() => setLoading(false), 0);
    return () => clearTimeout(t);
  }, [roomId, router, userId, room, setRoom, setGameData, setUserInfo]);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    setRoom(null);
    router.push('/');
  };


  const handleHint = useCallback(() => {
    if (!userId) return;
    const hintData = useGameStore.getState().useHint(userId);
    if (hintData) {
      updateCell(hintData.row, hintData.col, hintData.value, userId);
      broadcastMove(hintData.row, hintData.col, hintData.value);
    }
  }, [userId, updateCell, broadcastMove]);


  const handleNumpadClick = useCallback((num: number) => {
    if (!selectedCell || !userId) return;

    // Check if correct
    if (solution) {
      const isCorrect = solution[selectedCell.row][selectedCell.col] === num;
      if (isCorrect) {
        toast.success('✅', { duration: 1500, style: { background: 'transparent', boxShadow: 'none' }, icon: null });
      } else {
        toast.error('❌', { duration: 1500, style: { background: 'transparent', boxShadow: 'none' }, icon: null });
      }
    }

    updateCell(selectedCell.row, selectedCell.col, num, userId);
    broadcastMove(selectedCell.row, selectedCell.col, num);
  }, [selectedCell, userId, updateCell, broadcastMove, solution]);


  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Loading room...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Sudoku Together</h1>
          <div className="h-6 w-px bg-border hidden sm:block" />
          <div className="hidden sm:flex items-center gap-2 text-sm text-secondary bg-background px-3 py-1.5 rounded-full border border-border">
            <span>Room Code:</span>
            <span className="font-mono font-medium text-foreground tracking-wider">{roomId}</span>
            <button
              onClick={copyRoomCode}
              className="ml-2 hover:text-foreground transition-colors"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 mr-4">
            <span className="text-sm font-medium">{username}</span>
            <div className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center text-sm font-bold">
              {username?.charAt(0).toUpperCase()}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)} className="px-2">
            <Settings className="w-5 h-5" />
          </Button>
          <Button variant="outline" size="sm" onClick={leaveRoom}>
            <LogOut className="w-4 h-4 mr-2" />
            Leave
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Left: Players & Chat */}
        <div className="space-y-6 flex flex-col h-full lg:col-span-1">
          <Card className="flex-1 flex flex-col overflow-hidden max-h-[40vh] lg:max-h-none">
            <div className="p-4 border-b border-border bg-background/50 flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Users className="w-4 h-4" /> Players
              </h2>
              <span className="text-xs text-secondary bg-secondary/10 px-2 py-1 rounded-full">
                {Object.keys(room?.players || {}).length} / {room?.maxPlayers || 4}
              </span>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {Object.values(room?.players || {}).map(player => (
                <div key={player.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: player.color }}
                    />
                    <span className="text-sm font-medium">
                      {player.username} {player.isHost && <span className="text-xs text-secondary">(Host)</span>}
                    </span>
                  </div>
                  <span className="text-sm font-mono">{player.score}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex-1 flex flex-col overflow-hidden max-h-[30vh] lg:max-h-none">
            <div className="p-4 border-b border-border bg-background/50">
              <h2 className="font-semibold">Chat</h2>
            </div>
            <div className="flex-1 p-4 flex flex-col overflow-y-auto space-y-2 text-sm">
              {messages.length === 0 ? (
                <div className="text-secondary italic text-center mt-auto mb-auto">No messages yet.</div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className="flex flex-col">
                    <span className="font-semibold text-xs">{msg.username}</span>
                    <span className="bg-secondary/10 px-2 py-1 rounded-md w-fit max-w-full break-words">{msg.text}</span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-border">
              <form onSubmit={handleChatSubmit}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                />
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
                <div className="text-2xl font-mono">00:00</div>
                <p className="text-secondary text-sm">Elapsed</p>
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
          <p className="text-secondary text-sm">Settings coming soon...</p>
          <div className="flex justify-end">
            <Button onClick={() => setIsSettingsOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
