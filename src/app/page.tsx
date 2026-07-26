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
import { Play, Users, Sparkles } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const setUserInfo = useGameStore(state => state.setUserInfo);

  const [username, setUsername] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  // Room configuration state
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

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Masukkan nama terlebih dahulu.');
      return;
    }

    handleSaveUsername(username);

    // Generate random room code
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Store room config in session storage for the room page
    sessionStorage.setItem('temp_room_config', JSON.stringify({
      isHost: true,
      difficulty,
      mode,
      maxPlayers
    }));

    router.push(`/room/${roomId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Masukkan nama terlebih dahulu.');
      return;
    }
    if (!joinCode.trim()) {
      setError('Masukkan kode room.');
      return;
    }

    handleSaveUsername(username);
    router.push(`/room/${joinCode.trim().toUpperCase()}`);
  };

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-background text-foreground p-6">
      <main className="flex flex-col items-center max-w-md w-full gap-8 text-center">
        <div className="space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-foreground text-background mb-2 shadow-lg">
            <Sparkles className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Sudoku Together</h1>
          <p className="text-secondary text-sm">
            Mainkan Sudoku secara multiplayer real-time bersama teman-temanmu.
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
            <Button
              fullWidth
              size="lg"
              onClick={() => {
                if (!username.trim()) {
                  setError('Masukkan nama kamu dulu ya!');
                  return;
                }
                setIsCreateModalOpen(true);
              }}
            >
              <Play className="w-4 h-4 mr-2" /> Buat Room Baru
            </Button>

            <Button
              variant="outline"
              fullWidth
              size="lg"
              onClick={() => {
                if (!username.trim()) {
                  setError('Masukkan nama kamu dulu ya!');
                  return;
                }
                setIsJoinModalOpen(true);
              }}
            >
              <Users className="w-4 h-4 mr-2" /> Gabung Room
            </Button>
          </div>
        </Card>
      </main>

      {/* Create Room Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Pengaturan Room"
      >
        <form onSubmit={handleCreateRoom} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Kesulitan (Difficulty)</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
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
              value={mode}
              onChange={(e) => setMode(e.target.value as GameMode)}
              className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground"
            >
              <option value="collaborative">Collaborative (Kerjasama)</option>
              <option value="classic">Classic (Klasik)</option>
              <option value="race">Race (Balapan Skor)</option>
              <option value="zen">Zen (Santai)</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Maksimal Pemain</label>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground"
            >
              <option value={2}>2 Pemain</option>
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

      {/* Join Room Modal */}
      <Modal
        isOpen={isJoinModalOpen}
        onClose={() => setIsJoinModalOpen(false)}
        title="Gabung Room"
      >
        <form onSubmit={handleJoinRoom} className="space-y-4">
          <Input
            label="Kode Room"
            placeholder="Masukkan kode room..."
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value);
              setError('');
            }}
            error={error && !joinCode.trim() ? error : undefined}
          />

          <div className="pt-2">
            <Button type="submit" formMethod="dialog" fullWidth size="lg">
              Masuk Room
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
