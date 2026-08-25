"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import React, { useState, useEffect, useRef } from 'react';
import { User, Camera, Trash2, Save, X, Loader2 } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import { getStoredAvatar, setStoredAvatar, processAvatarImage, getAvatarFallbackLabel } from '@/utils/avatar';
import { getOrCreateUserId } from '@/utils/uuid';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';

interface ProfileWidgetProps {
  // Called when avatar is changed locally; parent in room can forward to realtime broadcast
  onAvatarUpdate?: (avatar: string | null) => void;
  // Compact mode for header (show username on desktop, hide on mobile already handled)
  compact?: boolean;
}

export const ProfileWidget: React.FC<ProfileWidgetProps> = ({ onAvatarUpdate, compact = false }) => {
  const userId = useGameStore((s) => s.userId);
  const username = useGameStore((s) => s.username);
  const room = useGameStore((s) => s.room);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Avoid hydration mismatch: server and initial client must render identical fallback.
  // Only after mount we read browser storage / realtime presence.
  const storedAvatar = mounted ? getStoredAvatar() : null;
  const playerAvatar = mounted && userId ? room?.players[userId]?.avatar ?? null : null;
  const displayAvatar = mounted ? (playerAvatar ?? storedAvatar ?? null) : null;
  const displayName = mounted ? (username || localStorage.getItem('sudoku_username') || 'PLAYER') : 'PLAYER';

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync preview when opening
  useEffect(() => {
    if (isEditorOpen) {
      setPreview(displayAvatar);
      setPendingFile(null);
      setError(null);
    }
  }, [isEditorOpen, displayAvatar]);

  // Ensure localStorage avatar is reflected in room on mount (fix TES1 stale room)
  useEffect(() => {
    if (!userId || !room) return;
    const localAv = getStoredAvatar();
    const roomAv = room.players[userId]?.avatar ?? null;
    if (localAv !== roomAv && localAv !== null) {
      // Local has avatar but room doesn't -> sync
      // Do not broadcast here (will be handled by presence on next track), just local update
      // But we can trigger onAvatarUpdate if provided
      if (onAvatarUpdate && roomAv === null) {
        // Let parent handle broadcast if needed; we just update store
        useGameStore.getState().updatePlayer(userId, { avatar: localAv });
      }
    }
  }, [userId, room, onAvatarUpdate]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPendingFile(file);
    setIsProcessing(true);
    try {
      const dataUrl = await processAvatarImage(file);
      setPreview(dataUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses gambar';
      setError(msg);
      toast.error(msg);
      setPreview(displayAvatar);
    } finally {
      setIsProcessing(false);
      // reset input so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (isProcessing) return;
    // If pendingFile but preview is still old due to error, re-process
    let finalAvatar: string | null = preview;
    // If user removed avatar (preview null)
    if (preview === null) {
      finalAvatar = null;
    }
    // Persist locally
    const ok = setStoredAvatar(finalAvatar);
    if (!ok) {
      toast.error('Gagal menyimpan avatar (storage penuh?)');
      return;
    }
    // Update local player in room immediately (optimistic)
    if (userId) {
      const uid = userId || getOrCreateUserId();
      // Ensure username is still set
      if (!username && displayName) {
        useGameStore.getState().setUserInfo(uid, displayName);
      }
      useGameStore.getState().updatePlayer(uid, { avatar: finalAvatar });
    }
    // Broadcast realtime if handler provided
    if (onAvatarUpdate) {
      onAvatarUpdate(finalAvatar);
    } else if (userId) {
      // Fallback: at least update presence via direct store? No broadcast available on home page
      // Home page just needs localStorage
    }
    toast.success(finalAvatar ? 'Avatar disimpan!' : 'Avatar dihapus');
    setIsEditorOpen(false);
  };

  const handleRemove = () => {
    setPreview(null);
    setPendingFile(null);
    setError(null);
  };

  const fallbackLabel = getAvatarFallbackLabel(displayName);

  return (
    <>
      {/* Top-right avatar button */}
      <button
        type="button"
        onClick={() => setIsEditorOpen(true)}
        className={`group flex items-center gap-2.5 rounded-full border border-border bg-card shadow-sm hover:shadow-md hover:bg-hover transition-all duration-150 active:scale-[0.97] cursor-pointer ${compact ? 'px-2 py-1.5 sm:px-3 sm:py-2' : 'px-3 py-2 sm:px-4 sm:py-2.5'}`}
        aria-label="Buka profil avatar"
        title="Profil"
      >
        <div className={`relative shrink-0 ${compact ? 'w-7 h-7 sm:w-8 sm:h-8' : 'w-8 h-8 sm:w-9 sm:h-9'}`}>
          <div className="w-full h-full rounded-full overflow-hidden border border-border bg-secondary/20 flex items-center justify-center font-bold text-foreground text-[11px] sm:text-xs">
            {displayAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayAvatar} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="select-none">{fallbackLabel}</span>
            )}
          </div>
          <span className="absolute -bottom-1 -right-1 bg-foreground text-background rounded-full p-1 border-2 border-card shadow-sm opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none">
            <Camera className="w-3 h-3" />
          </span>
        </div>
        <div className={`flex flex-col items-start leading-none ${compact ? 'hidden sm:flex' : 'hidden sm:flex'}`}>
          <span className="text-xs sm:text-sm font-semibold tracking-wide max-w-[90px] truncate">{displayName}</span>
          <span className="text-[10px] text-secondary">Ganti avatar</span>
        </div>
        {/* Mobile: show only avatar, no text - already handled via hidden sm:flex */}
      </button>

      {/* Editor Modal */}
      <Modal isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} title="Profil Player">
        <div className="flex flex-col gap-5">
          {/* Preview */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-2 border-border bg-secondary/10 flex items-center justify-center shadow-inner">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="preview avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-secondary">
                  <User className="w-8 h-8" />
                  <span className="text-[11px]">No avatar</span>
                </div>
              )}
              {isProcessing && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-foreground" />
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold">{displayName}</p>
              <p className="text-xs text-secondary">Preview avatar kamu</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2.5">
            <Button
              variant="outline"
              fullWidth
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="gap-2"
            >
              <Camera className="w-4 h-4" />
              {preview ? 'Ganti Gambar' : 'Upload Gambar'}
            </Button>
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

            {preview && (
              <Button variant="ghost" fullWidth onClick={handleRemove} disabled={isProcessing} className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-500/10">
                <Trash2 className="w-4 h-4" />
                Hapus Avatar
              </Button>
            )}

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs px-3 py-2.5">
                {error}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-secondary text-center px-2">
              Gambar akan di-resize ke 128px, di-kompres JPEG ~75% dan disimpan lokal. Max 5MB sebelum kompresi. Tidak mengganggu game.
            </p>
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-2.5 pt-2 border-t border-border">
            <Button variant="outline" fullWidth onClick={() => setIsEditorOpen(false)} disabled={isProcessing} className="gap-2">
              <X className="w-4 h-4" />
              Batal
            </Button>
            <Button fullWidth onClick={handleSave} disabled={isProcessing} className="gap-2">
              <Save className="w-4 h-4" />
              Simpan
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
