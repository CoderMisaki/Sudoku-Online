"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { getOrCreateUserId } from '@/utils/uuid';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { ProfileWidget } from '@/components/profile/ProfileWidget';
import { ErrorLogPanel } from '@/components/admin/ErrorLogPanel';
import { OnlinePlayersBox } from '@/components/online/OnlinePlayersBox';
import { initErrorLogger, addErrorLog } from '@/utils/errorLogger';
import { Difficulty, GameMode } from '@/types/game';
import { Play, Users, ClipboardPaste, Lock, Settings } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Home() {
  const router = useRouter();
  const setUserInfo = useGameStore(state => state.setUserInfo);
  const resetGame = useGameStore(state => state.resetGame);

  const clearRoomStateBeforeNavigate = () => {
    resetGame();
    useGameStore.getState().clearPersistedStorage();
  };

  const [username, setUsername] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [mode, setMode] = useState<GameMode>('collaborative');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  // Admin gate — password never in client bundle, verified via /api/admin/verify
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [adminPasswordModalOpen, setAdminPasswordModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState('');
  const [adminPendingAction, setAdminPendingAction] = useState<null | 'create'>(null);
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(false);
  const isAdminUser = username.trim().toUpperCase() === 'ADMIN';

  // Theme — mengikuti localStorage (sudoku_theme)
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
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('sudoku_theme', newTheme);
    applyTheme(newTheme);
  };

  useEffect(() => {
    initErrorLogger();
    try {
      const verified = sessionStorage.getItem('sudoku_admin_verified') === '1';
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage to state sync on mount is intentional
      if (verified) setIsAdminVerified(true);
    } catch {}
    const storedTheme = (localStorage.getItem('sudoku_theme') as 'light' | 'dark' | 'system') || 'system';
    setTimeout(() => {
      setTheme(storedTheme);
      applyTheme(storedTheme);
    }, 0);
  }, [applyTheme]);

  useEffect(() => {
    const storedName = localStorage.getItem('sudoku_username') || '';
    if (storedName) {
      const upper = storedName.toUpperCase();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsername(upper);
      // Sinkronkan ke store juga supaya tidak stale TES1 setelah refresh
      try {
        const uid = getOrCreateUserId();
        setUserInfo(uid, upper);
        // Perbaiki jika localStorage masih ada huruf kecil
        if (storedName !== upper) localStorage.setItem('sudoku_username', upper);
        // Perbaiki persisted room yang masih menyimpan TES1 lama
        const st = useGameStore.getState();
        if (st.room?.players[uid] && st.room.players[uid].username !== upper) {
          st.updatePlayer(uid, { username: upper });
        }
      } catch {}
    }
    getOrCreateUserId();
  }, [setUserInfo]);

  // Clear admin verified if username changes away from ADMIN
  useEffect(() => {
    if (username.trim().toUpperCase() !== 'ADMIN' && isAdminVerified) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing verified state when username leaves ADMIN is intentional
      setIsAdminVerified(false);
      try { sessionStorage.removeItem('sudoku_admin_verified'); } catch {}
    }
  }, [username, isAdminVerified]);

  const handleSaveUsername = (name: string) => {
    const upper = name.toUpperCase();
    setUsername(upper);
    localStorage.setItem('sudoku_username', upper);
    const userId = getOrCreateUserId();
    setUserInfo(userId, upper);
  };

  const handleOpenCreateModal = () => {
    setError('');
    setIsJoinModalOpen(false);
    setIsCreateModalOpen(true);
  };

  const handleOpenJoinModal = () => {
    setError('');
    setJoinCode('');
    setIsCreateModalOpen(false);
    setIsJoinModalOpen(true);
  };

  const handleModeChange = (newMode: GameMode) => {
    setMode(newMode);
    if (newMode === 'tic_tac_toe') {
      if (difficulty !== '3x3' && difficulty !== '8x8') {
        setDifficulty('3x3');
      }
      setMaxPlayers(2);
    } else {
      // Arrow Puzzle Master & Sudoku sama-sama memakai Easy .. Evil.
      if (difficulty === '3x3' || difficulty === '8x8') {
        setDifficulty('medium');
      }
      // Arrow Puzzle boleh 2-8 pemain (Classic ko-op / Competition / Practice papan sendiri),
      // jadi pilihan jumlah pemain tidak dipaksa kembali ke 4.
      if (newMode !== 'arrow_classic' && newMode !== 'arrow_competition' && newMode !== 'arrow_practice') {
        setMaxPlayers(4);
      }
    }
  };

  const doCreateRoom = () => {
    handleSaveUsername(username);
    clearRoomStateBeforeNavigate();
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const finalDiff = mode === 'tic_tac_toe' && difficulty !== '3x3' && difficulty !== '8x8' ? '3x3' : difficulty;
    const finalMaxPlayers = mode === 'tic_tac_toe' ? 2 : maxPlayers;

    sessionStorage.setItem(`sudoku_host_room_${roomId}`, '1');
    sessionStorage.setItem(`sudoku_room_config_${roomId}`, JSON.stringify({
      isHost: true,
      difficulty: finalDiff,
      mode,
      maxPlayers: finalMaxPlayers
    }));
    router.push(`/room/${roomId}`);
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim().toUpperCase() === 'ADMIN' && !isAdminVerified) {
      setAdminPendingAction('create');
      setAdminPassword('');
      setAdminPasswordError('');
      setAdminPasswordModalOpen(true);
      return;
    }
    doCreateRoom();
  };

  const handleAdminPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPassword) {
      setAdminPasswordError('Masukkan password Admin');
      return;
    }
    setIsVerifyingAdmin(true);
    setAdminPasswordError('');
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ADMIN', password: adminPassword }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setIsAdminVerified(true);
        try { sessionStorage.setItem('sudoku_admin_verified', '1'); } catch {}
        toast.success('Admin terverifikasi');
        setAdminPasswordModalOpen(false);
        setAdminPassword('');
        if (adminPendingAction === 'create') {
          doCreateRoom();
        }
        setAdminPendingAction(null);
      } else {
        const msg = data.error || 'Password salah';
        setAdminPasswordError(msg);
        addErrorLog({ level: 'warn', message: `Admin verify failed: ${msg}`, source: 'admin-gate' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal verifikasi';
      setAdminPasswordError(msg);
      addErrorLog({ level: 'error', message: `Admin verify error: ${msg}`, source: 'admin-gate' });
    } finally {
      setIsVerifyingAdmin(false);
    }
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
    const cleanCode = joinCode.trim().toUpperCase();
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
    <div className="flex flex-col flex-1 items-center justify-center bg-background text-foreground p-6 relative">
      {/* Top-right: settings + error logs (Admin) */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 flex items-center gap-1.5 sm:gap-2">
        {isAdminUser && isAdminVerified && <ErrorLogPanel isAdmin={true} />}
        <ProfileWidget />
        <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)} className="p-1.5 h-8 w-8" aria-label="Pengaturan">
          <Settings className="w-4 h-4" />
        </Button>
      </div>
      <main className="flex flex-col items-center max-w-md w-full gap-8 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Sudoku Together</h1>
          <p className="text-secondary text-sm">
            Mainkan Sudoku, Ular Tangga, Tic Tac Toe, &amp; Arrow Puzzle Master secara
            multiplayer real-time bersama teman-temanmu.
          </p>
        </div>

        <Card className="w-full p-6 space-y-6 text-left">
          <Input
            label="Nama Kamu"
            placeholder="Contoh: ALEX"
            value={username}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="uppercase"
            style={{ textTransform: 'uppercase' } as React.CSSProperties}
            onChange={(e) => {
              const upper = e.target.value.toUpperCase();
              setUsername(upper);
              try {
                localStorage.setItem('sudoku_username', upper);
                const uid = getOrCreateUserId();
                setUserInfo(uid, upper);
              } catch {}
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

        {/* Player Online — realtime, ada di halaman pertama */}
        <div className="w-full">
          <OnlinePlayersBox variant="lobby" />
        </div>
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
              {mode === 'tic_tac_toe' ? (
                <>
                  <option value="3x3">3x3 (Klasik - 3 Segaris)</option>
                  <option value="8x8">8x8 (Lanjutan - 5 Segaris)</option>
                </>
              ) : (
                <>
                  <option value="easy">Easy (Mudah)</option>
                  <option value="medium">Medium (Sedang)</option>
                  <option value="hard">Hard (Sulit)</option>
                  <option value="expert">Expert (Pakar)</option>
                  <option value="evil">Evil (Ekstrem)</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Mode Permainan</label>
            <select
              value={mode}
              onChange={(e) => handleModeChange(e.target.value as GameMode)}
              className="w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground cursor-pointer"
            >
              <option value="collaborative">Collaborative (Kerjasama)</option>
              <option value="competition">Competition (Persaingan)</option>
              <option value="classic">Classic (Klasik)</option>
              <option value="race">Race (Balapan Skor)</option>
              <option value="zen">Zen (Santai)</option>
              <option value="snakes_and_ladders">Snakes &amp; Ladders (Ular Tangga)</option>
              <option value="tic_tac_toe">Tic Tac Toe</option>
              <option value="arrow_classic">Arrow Puzzle Master — Classic</option>
              <option value="arrow_competition">Arrow Puzzle Master — Competition</option>
              <option value="arrow_practice">Arrow Puzzle Master — Practice</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Maksimal Pemain</label>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              disabled={mode === 'tic_tac_toe'}
              className={`w-full h-11 rounded-[16px] border border-border bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-foreground cursor-pointer ${
                mode === 'tic_tac_toe' ? 'opacity-80 bg-secondary/10' : ''
              }`}
            >
              {mode === 'tic_tac_toe' ? (
                <option value={2}>2 Pemain (Maksimal)</option>
              ) : (
                <>
                  <option value={2}>2 Pemain</option>
                  <option value={3}>3 Pemain</option>
                  <option value={4}>4 Pemain</option>
                  <option value={6}>6 Pemain</option>
                  <option value={8}>8 Pemain</option>
                </>
              )}
            </select>
            {mode === 'tic_tac_toe' && (
              <p className="text-[11px] text-secondary mt-1">
                * Tic Tac Toe otomatis bermain lawan Bot jika sendirian di room.
              </p>
            )}
            {mode === 'arrow_classic' && (
              <p className="text-[11px] text-secondary mt-1">
                * Arrow Classic: satu papan panah dikerjakan bareng-bareng secara realtime.
                Benar +10, salah beruntun -5, -10, -20, ... (kelipatan 2x).
              </p>
            )}
            {mode === 'arrow_competition' && (
              <p className="text-[11px] text-secondary mt-1">
                * Arrow Competition: tiap pemain dapat papan sendiri, adu cepat mengeluarkan semua arrow
                seperti Sudoku Competition.
              </p>
            )}
            {mode === 'arrow_practice' && (
              <p className="text-[11px] text-secondary mt-1">
                * Arrow Practice: mode belajar — tiap pemain dapat papan acak sendiri (tidak pernah sama),
                lengkap dengan tombol Auto &amp; All untuk membantu tanpa batas poin.
              </p>
            )}
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
              placeholder="MASUKAN CODE ROOM..."
              value={joinCode}
              maxLength={5}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="uppercase"
              style={{ textTransform: 'uppercase' } as React.CSSProperties}
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

      {/* Admin Password Modal — hanya untuk username ADMIN */}
      <Modal
        isOpen={adminPasswordModalOpen}
        onClose={() => {
          setAdminPasswordModalOpen(false);
          setAdminPassword('');
          setAdminPasswordError('');
          setAdminPendingAction(null);
        }}
        title="Verifikasi Admin"
      >
        <form onSubmit={handleAdminPasswordSubmit} className="space-y-4">
          <p className="text-xs text-secondary">
            Username <b>ADMIN</b> memerlukan password untuk membuat room.
          </p>
          <div>
            <label className="text-sm font-medium block mb-1.5">Password Admin</label>
            <div className="relative">
              <Input
                type="password"
                placeholder="Masukkan password Admin"
                value={adminPassword}
                onChange={(e) => {
                  setAdminPassword(e.target.value);
                  setAdminPasswordError('');
                }}
                error={adminPasswordError || undefined}
                autoComplete="off"
              />
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none" />
            </div>
          </div>
          <div className="pt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              fullWidth
              onClick={() => {
                setAdminPasswordModalOpen(false);
                setAdminPassword('');
                setAdminPasswordError('');
                setAdminPendingAction(null);
              }}
            >
              Batal
            </Button>
            <Button type="submit" fullWidth disabled={isVerifyingAdmin}>
              {isVerifyingAdmin ? 'Verifikasi...' : 'Verifikasi'}
            </Button>
          </div>
        </form>
      </Modal>

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
