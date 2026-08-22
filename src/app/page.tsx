"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { getOrCreateUserId } from '@/utils/uuid';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Difficulty, GameMode } from '@/types/game';
import { Play, Users, ClipboardPaste } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const setUserInfo = useGameStore(state => state.setUserInfo);
  const resetGame = useGameStore(state => state.resetGame);

  const clearRoomStateBeforeNavigate = () => {
    resetGame();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useGameStore as any).persist?.clearStorage?.();
  };

  const [username, setUsername] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [mode, setMode] = useState<GameMode>('collaborative');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const storedName = localStorage.getItem('sudoku_username') || '';
    if (storedName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsername(storedName);
    }
    getOrCreateUserId();
  }, []);

  const handleSaveUsername = (name: string) => {
    setUsername(name);
    localStorage.setItem('sudoku_username', name);
    const userId = getOrCreateUserId();
    setUserInfo(userId, name);
  };

  const handleOpenCreateModal = () => {
    if (!username.trim()) {
      setError('Masukkan nama kamu dulu ya!');
      return;
    }
    setError('');
    setIsJoinModalOpen(false);
    setIsCreateModalOpen(true);
  };

  const handleOpenJoinModal = () => {
    if (!username.trim()) {
      setError('Masukkan nama kamu dulu ya!');
      return;
    }
    setError('');
    setJoinCode('');
    setIsCreateModalOpen(false);
    setIsJoinModalOpen(true);
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Masukkan nama terlebih dahulu.');
      return;
    }

    handleSaveUsername(username);
    clearRoomStateBeforeNavigate();

    // Generate kode room 5 karakter
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    sessionStorage.setItem(`sudoku_host_room_${roomId}`, '1');

    sessionStorage.setItem(`sudoku_room_config_${roomId}`, JSON.stringify({
      isHost: true,
      difficulty,
      mode,
      maxPlayers
    }));

    router.push(`/room/${roomId}`);
  };

  const handlePasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const clean = text.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase();
      setJoinCode(clean);
      if (clean.length === 5) {
        setError('');
      }
    } catch {
      setError('Gagal membaca clipboard.');
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Masukkan nama terlebih dahulu.');
      return;
    }

    const cleanCode = joinCode.trim().toUpperCase();
    // Validasi panjang dan karakter harus 5 digit alfanumerik
    if (cleanCode.length !== 5 || !/^[A-Z0-9]{5}$/.test(cleanCode)) {
      setError('Code not valid');
      return;
    }

    setError('');
    handleSaveUsername(username);
    clearRoomStateBeforeNavigate();
    router.push(`/room/${cleanCode}`);
  };

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-background text-foreground p-6">
      <main className="flex flex-col items-center max-w-md w-full gap-8 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Sudoku Together</h1>
          <p className="text-secondary text-sm">
            Mainkan Sudoku & Ular Tangga secara multiplayer real-time bersama teman-temanmu.
          </p>
        </div>

        <Card className="w-full p-6 space-y-6 text-left">
          <Input
            label="Nama Kamu"
            placeholder="Contoh: Alex"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError('');
            }}
            error={error && !username.trim() ? error : undefined}
          />

          <div className="space-y-3 pt-2">
            <Button fullWidth size="lg" onClick={handleOpenCreateModal}>
              <Play className="w-4 h-4 mr-2" /> Buat Room Baru
            </Button>

            <Button variant="outline" fullWidth size="lg" onClick={handleOpenJoinModal}>
              <Users className="w-4 h-4 mr-2" /> Gabung Room
            </Button>
          </div>
        </Card>
      </main>

      {/* Create Room Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setError('');
        }}
        title="Pengaturan Room"
      >
        <form onSubmit={handleCreateRoom} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Kesulitan (Difficulty)</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground cursor-pointer"
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
              value={mode}
              onChange={(e) => setMode(e.target.value as GameMode)}
              className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground cursor-pointer"
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
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground cursor-pointer"
            >
              <option value={2}>2 Pemain</option>
              <option value={3}>3 Pemain</option>
              <option value={4}>4 Pemain</option>
              <option value={6}>6 Pemain</option>
              <option value={8}>8 Pemain</option>
            </select>
          </div>

          <div className="pt-4">
            <Button type="submit" fullWidth size="lg">
              Mulai Room
            </Button>
          </div>
        </form>
      </Modal>

      {/* Join Room Modal dengan Fitur Paste & Validasi 5 Karakter */}
      <Modal
        isOpen={isJoinModalOpen}
        onClose={() => {
          setIsJoinModalOpen(false);
          setJoinCode('');
          setError('');
        }}
        title="Gabung Room"
      >
        <form onSubmit={handleJoinRoom} className="space-y-4">
          <div className="relative">
            <Input
              label="Kode Room"
              placeholder="Masukan code room..."
              value={joinCode}
              maxLength={5}
              onChange={(e) => {
                const clean = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase();
                setJoinCode(clean);
                setError('');
              }}
              error={error}
            />
            <button
              type="button"
              onClick={handlePasteCode}
              className="absolute right-3 top-[32px] px-2.5 py-1 text-xs font-semibold bg-secondary/15 hover:bg-secondary/25 text-foreground rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              Paste
            </button>
          </div>

          <div className="pt-2">
            <Button type="submit" fullWidth size="lg">
              Masuk Room
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
