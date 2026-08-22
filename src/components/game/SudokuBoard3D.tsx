"use client";

import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

interface SudokuBoard3DProps {
  broadcastMove: (row: number, col: number, value: number | null) => void;
  broadcastNote: (row: number, col: number, note: number) => void;
  broadcastCursor: (row: number, col: number) => void;
  lockCell: (row: number, col: number) => boolean | void;
  locks: Record<string, { userId: string; expiresAt: number }>;
  isPencilMode: boolean;
  isEraserMode: boolean;
  className?: string;
}

interface TileMeta {
  row: number;
  col: number;
  mesh: THREE.Mesh;
  targetY: number;
  currentY: number;
  shakeTime: number;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  materials: THREE.Material[];
  lastRenderKey: string;
}

export const SudokuBoard3D: React.FC<SudokuBoard3DProps> = ({
  broadcastMove,
  broadcastNote,
  broadcastCursor,
  lockCell,
  locks,
  isPencilMode,
  isEraserMode,
  className
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const grid = useGameStore(state => state.grid);
  const selectedCell = useGameStore(state => state.selectedCell);
  const setSelectedCell = useGameStore(state => state.setSelectedCell);
  const room = useGameStore(state => state.room);
  const userId = useGameStore(state => state.userId);

  const isCompetition = room?.mode === 'competition';
  const nowRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      nowRef.current = Date.now();
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const isStunned = Boolean(room?.mode === 'race' && userId && (room?.players[userId]?.stunnedUntil ?? 0) > nowRef.current);

  const tilesRef = useRef<TileMeta[]>([]);
  const hoveredCellRef = useRef<{ row: number; col: number } | null>(null);
  const prevGridRef = useRef(grid);

  // Helper render tekstur canvas dengan caching state agar tidak boros CPU/GPU
  const updateTileTexture = useCallback((tile: TileMeta, force = false) => {
    const { row, col, canvas, texture } = tile;
    if (!grid) return;

    const cell = grid[row][col];
    const isSelected = selectedCell?.row === row && selectedCell?.col === col;

    let isSameValue = false;
    if (selectedCell) {
      const selectedVal = grid[selectedCell.row][selectedCell.col]?.value;
      isSameValue = selectedVal !== null && selectedVal !== undefined && cell.value === selectedVal;
    }

    const isError = Boolean(cell.isConflicting || cell.isWrong);
    const isFixed = Boolean(cell.isLocked || cell.isCorrect);
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const isPending = Boolean(cell.isPending);

    // Kunci unik untuk memvalidasi apakah perlu redraw canvas
    const renderKey = `${cell.value}_${cell.notes.join('-')}_${isSelected}_${isSameValue}_${isError}_${isFixed}_${isDark}_${isPending}_${room?.mode}`;

    if (!force && tile.lastRenderKey === renderKey) {
      return; // Skip redraw jika state tidak ada yang berubah
    }
    tile.lastRenderKey = renderKey;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Palet Warna Minimalis & Mewah
    let bgColor = isDark ? '#18181b' : '#ffffff';
    let borderColor = isDark ? '#27272a' : '#e4e4e7';
    let textColor = isDark ? '#f4f4f5' : '#09090b';

    if (isSelected && !isError) {
      bgColor = isDark ? '#2563eb' : '#3b82f6';
      borderColor = '#60a5fa';
      textColor = '#ffffff';
    } else if (isError) {
      bgColor = room?.mode === 'zen' ? '#ea580c' : '#dc2626';
      borderColor = '#fca5a5';
      textColor = '#ffffff';
    } else if (isSameValue) {
      bgColor = isDark ? '#27272a' : '#f1f5f9';
      borderColor = '#f43f5e';
      textColor = '#f43f5e';
    }

    // Gambar Base Balok Kotak (Chamfered Corner)
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 16, h - 16, 20);
    ctx.fill();

    // Border Kotak
    ctx.lineWidth = isSelected ? 8 : (isSameValue ? 6 : 3);
    ctx.strokeStyle = borderColor;
    ctx.stroke();

    // Render Angka Utama
    if (cell.value !== null) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${isFixed ? '118px' : '108px'} -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

      if (isPending) {
        ctx.globalAlpha = 0.5;
      }

      if (!isSelected && !isSameValue && !isError) {
        textColor = isDark ? '#fafafa' : '#18181b';
      }

      ctx.fillStyle = textColor;
      ctx.fillText(cell.value.toString(), w / 2, h / 2 + 4);
      ctx.globalAlpha = 1.0;
    } else if (cell.notes.length > 0) {
      // Render Pensil / Notes Grid 3x3
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 32px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = isSelected ? '#ffffff' : (isDark ? '#a1a1aa' : '#64748b');

      for (let n = 1; n <= 9; n++) {
        if (cell.notes.includes(n)) {
          const subRow = Math.floor((n - 1) / 3);
          const subCol = (n - 1) % 3;
          const x = 46 + subCol * 82;
          const y = 48 + subRow * 82;
          ctx.fillText(n.toString(), x, y);
        }
      }
    }

    texture.needsUpdate = true;
  }, [grid, selectedCell, room?.mode]);

  // Pantau kesalahan input untuk memicu animasi goyang (micro-shake)
  useEffect(() => {
    if (!grid || !prevGridRef.current) {
      prevGridRef.current = grid;
      return;
    }

    grid.forEach((row, r) => {
      row.forEach((cell, c) => {
        const prevCell = prevGridRef.current?.[r]?.[c];
        const isNowError = cell.isConflicting || cell.isWrong;
        const wasError = prevCell?.isConflicting || prevCell?.isWrong;

        if (isNowError && !wasError) {
          const targetTile = tilesRef.current.find(t => t.row === r && t.col === c);
          if (targetTile) {
            targetTile.shakeTime = 0.35; // Goyang selama 350ms
          }
        }
      });
    });

    prevGridRef.current = grid;
  }, [grid]);

  // Update tekstur balok saat terjadi perubahan data
  useEffect(() => {
    tilesRef.current.forEach(tile => updateTileTexture(tile));
  }, [grid, selectedCell, updateTileTexture]);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (!grid || isStunned) return;

    if (!isCompetition) {
      const key = `${row}-${col}`;
      const currentLock = locks[key];
      if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
        return;
      }
    }

    setSelectedCell({ row, col });
    if (!isCompetition) {
      broadcastCursor(row, col);
      lockCell(row, col);
    }
  }, [grid, isStunned, isCompetition, locks, userId, setSelectedCell, broadcastCursor, lockCell]);

  const handleCellClickRef = useRef(handleCellClick);
  useEffect(() => {
    handleCellClickRef.current = handleCellClick;
  }, [handleCellClick]);

  // Handle Keyboard Navigasi & Input
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!grid || !userId || isStunned) return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const current = selectedCell || { row: 0, col: 0 };
      let newRow = current.row;
      let newCol = current.col;
      if (e.key === 'ArrowUp') newRow = Math.max(0, current.row - 1);
      if (e.key === 'ArrowDown') newRow = Math.min(8, current.row + 1);
      if (e.key === 'ArrowLeft') newCol = Math.max(0, current.col - 1);
      if (e.key === 'ArrowRight') newCol = Math.min(8, current.col + 1);
      handleCellClick(newRow, newCol);
      return;
    }

    if (!selectedCell) return;
    const { row, col } = selectedCell;
    const cell = grid[row][col];

    if (!isCompetition) {
      const key = `${row}-${col}`;
      const currentLock = locks[key];
      if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) return;
    }

    const isCellFixed = Boolean(cell.isLocked || cell.isCorrect);

    if (e.key >= '1' && e.key <= '9') {
      const val = parseInt(e.key);
      if (isCellFixed) {
        toast('Jawaban sudah benar', { icon: '✅', id: 'cell-correct-3d' });
        return;
      }
      if (isEraserMode && cell.value === null) {
        if (cell.notes.includes(val)) broadcastNote(row, col, val);
      } else if (isPencilMode && cell.value === null) {
        broadcastNote(row, col, val);
      } else {
        broadcastMove(row, col, val);
      }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (isCellFixed) {
        toast('Jawaban sudah benar', { icon: '✅', id: 'cell-correct-3d' });
        return;
      }
      broadcastMove(row, col, null);
    }
  }, [grid, userId, isStunned, selectedCell, isCompetition, locks, handleCellClick, isEraserMode, isPencilMode, broadcastNote, broadcastMove]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Setup Three.js Scene, Near-2D Perspective Camera, & Meshes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();

    // Sudut Pandang 3D Mirip 2D (FOV sempit 30 derajat, kamera tinggi dengan kemiringan tipis)
    const camera = new THREE.PerspectiveCamera(30, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 15.2, 3.2);
    camera.lookAt(0, 0, -0.1);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    container.appendChild(renderer.domElement);

    // Pencahayaan Lembut Modern (Tanpa Dynamic Shadow Overhead)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(5, 12, 6);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.35);
    fillLight.position.set(-5, 8, -4);
    scene.add(fillLight);

    // Base Frame Sudoku (Alas Mewah dengan Sudut Membulat)
    const isDark = document.documentElement.classList.contains('dark');
    const boardGeo = new THREE.BoxGeometry(8.15, 0.22, 8.15);
    const boardMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x09090b : 0xe2e8f0,
      roughness: 0.4,
      metalness: 0.15,
    });
    const boardMesh = new THREE.Mesh(boardGeo, boardMat);
    boardMesh.position.y = -0.15;
    scene.add(boardMesh);

    // Single Shared Geometry untuk seluruh 81 Balok (Sangat Menghemat Memory GPU)
    const tileSize = 0.74;
    const tileHeight = 0.16;
    const sharedTileGeo = new THREE.BoxGeometry(tileSize, tileHeight, tileSize);

    const sideMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x27272a : 0xcbd5e1,
      roughness: 0.5,
      metalness: 0.1
    });

    const tiles: TileMeta[] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        // Pembagian jarak balok dan garis sub-grid 3x3
        const xOffset = (c - 4) * (tileSize + 0.05) + (Math.floor(c / 3) - 1) * 0.12;
        const zOffset = (r - 4) * (tileSize + 0.05) + (Math.floor(r / 3) - 1) * 0.12;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;

        const topMat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.25,
          metalness: 0.05
        });

        // Face Materials: right, left, top, bottom, front, back
        const materials = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
        const mesh = new THREE.Mesh(sharedTileGeo, materials);
        mesh.position.set(xOffset, 0, zOffset);
        mesh.userData = { row: r, col: c, baseX: xOffset };

        scene.add(mesh);

        const tileMeta: TileMeta = {
          row: r,
          col: c,
          mesh,
          targetY: 0,
          currentY: 0,
          shakeTime: 0,
          canvas,
          texture,
          materials,
          lastRenderKey: ''
        };

        tiles.push(tileMeta);
        updateTileTexture(tileMeta, true);
      }
    }
    tilesRef.current = tiles;

    // Raycaster untuk Klik Mouse & Pointer Touch
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getRaycastIntersect = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObjects(tiles.map(t => t.mesh));
    };

    const onPointerMove = (e: MouseEvent) => {
      const intersects = getRaycastIntersect(e.clientX, e.clientY);
      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const { row, col } = hitMesh.userData;
        hoveredCellRef.current = { row, col };
      } else {
        hoveredCellRef.current = null;
      }
    };

    const onPointerDown = (e: MouseEvent) => {
      const intersects = getRaycastIntersect(e.clientX, e.clientY);
      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const { row, col } = hitMesh.userData;
        handleCellClickRef.current(row, col);
      }
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousemove', onPointerMove, { passive: true });
    domElement.addEventListener('pointerdown', onPointerDown);

    // Render & Animation Loop (Smooth Lerp + Micro Shake)
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.1);

      tiles.forEach(tile => {
        const isSelected = selectedCell?.row === tile.row && selectedCell?.col === tile.col;
        const isHovered = hoveredCellRef.current?.row === tile.row && hoveredCellRef.current?.col === tile.col;

        // Elevasi 3D Ringan & Mewah
        if (isSelected) {
          tile.targetY = 0.16; // Timbul ke atas
        } else if (isHovered) {
          tile.targetY = 0.06; // Sedikit naik saat kursor mendekat
        } else {
          tile.targetY = 0;
        }

        // Interpolasi perpindahan halus (Damping Lerp)
        tile.currentY += (tile.targetY - tile.currentY) * (delta * 18);
        tile.mesh.position.y = tile.currentY;

        // Micro-Shake Animation saat salah input
        if (tile.shakeTime > 0) {
          tile.shakeTime -= delta;
          const shakeOffset = Math.sin(tile.shakeTime * 45) * 0.025;
          tile.mesh.position.x = tile.mesh.userData.baseX + shakeOffset;
          if (tile.shakeTime <= 0) {
            tile.mesh.position.x = tile.mesh.userData.baseX;
          }
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    // Auto Responsive Resize Handler
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      domElement.removeEventListener('mousemove', onPointerMove);
      domElement.removeEventListener('pointerdown', onPointerDown);

      tiles.forEach(t => {
        t.texture.dispose();
        t.materials.forEach(m => m.dispose());
      });

      sharedTileGeo.dispose();
      boardGeo.dispose();
      boardMat.dispose();
      sideMat.dispose();
      renderer.dispose();

      if (container.contains(domElement)) {
        container.removeChild(domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full aspect-square max-w-[580px] rounded-2xl relative overflow-hidden select-none cursor-pointer shadow-lg transition-opacity duration-300",
        isStunned && "opacity-50 grayscale",
        className
      )}
    />
  );
};
