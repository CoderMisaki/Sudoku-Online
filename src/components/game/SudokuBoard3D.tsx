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
  material: THREE.MeshStandardMaterial;
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
  const [now, setNow] = React.useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);
  const isStunned = (room?.mode === 'race' && userId && (room?.players[userId]?.stunnedUntil ?? 0) > now);

  const tilesRef = useRef<TileMeta[]>([]);
  const hoveredCellRef = useRef<{ row: number; col: number } | null>(null);
  const pointerLightRef = useRef<THREE.PointLight | null>(null);

  // Helper untuk menggambar tekstur atas kotak (Angka, Notes, Warna, Highlight)
  const updateTileTexture = useCallback((tile: TileMeta) => {
    const { row, col, canvas, texture } = tile;
    if (!grid) return;

    const cell = grid[row][col];
    const isSelected = selectedCell?.row === row && selectedCell?.col === col;

    let isSameValue = false;
    if (selectedCell) {
      const selectedVal = grid[selectedCell.row][selectedCell.col].value;
      isSameValue = selectedVal !== null && cell.value === selectedVal;
    }

    const isError = cell.isConflicting || cell.isWrong;
    const isFixed = Boolean(cell.isLocked || cell.isCorrect);

    const isDark = document.documentElement.classList.contains('dark');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background Canvas
    let bgColor = isDark ? '#18181b' : '#ffffff';
    if (isSelected && !isError) {
      bgColor = isDark ? '#3b82f6' : '#2563eb';
    } else if (isError) {
      bgColor = room?.mode === 'zen' ? '#fb923c' : '#ef4444';
    } else if (isSameValue) {
      bgColor = isDark ? '#3f3f46' : '#f4f4f5';
    }

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border Frame
    ctx.lineWidth = isSelected ? 12 : 4;
    ctx.strokeStyle = isSelected
      ? '#ffffff'
      : isSameValue
        ? '#f43f5e'
        : (isDark ? '#27272a' : '#e4e4e7');
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

    // Render Nilai Utama
    if (cell.value !== null) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${isFixed ? '110px' : '95px'} system-ui, -apple-system, sans-serif`;

      if (isSelected) {
        ctx.fillStyle = '#ffffff';
      } else if (isSameValue) {
        ctx.fillStyle = '#f43f5e';
      } else if (isError) {
        ctx.fillStyle = '#ffffff';
      } else if (isFixed) {
        ctx.fillStyle = isDark ? '#f4f4f5' : '#18181b';
      } else {
        ctx.fillStyle = isDark ? '#60a5fa' : '#2563eb';
      }

      ctx.fillText(cell.value.toString(), canvas.width / 2, canvas.height / 2 + 4);
    } else if (cell.notes.length > 0) {
      // Render Mode Pensil / Notes
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = isSelected ? '#ffffff' : (isDark ? '#a1a1aa' : '#52525b');

      for (let n = 1; n <= 9; n++) {
        if (cell.notes.includes(n)) {
          const subRow = Math.floor((n - 1) / 3);
          const subCol = (n - 1) % 3;
          const x = 45 + subCol * 83;
          const y = 45 + subRow * 83;
          ctx.fillText(n.toString(), x, y);
        }
      }
    }

    texture.needsUpdate = true;
  }, [grid, selectedCell, room?.mode]);

  // Update seluruh tekstur saat state grid / selectedCell berubah
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

  // Keyboard Handler (Arrows, Numpad, Delete, Eraser, Notes)
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

  // Setup Three.js Scene, Camera, Renderer, dan Meshes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();

    // Camera dengan Isometric Tilt
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 11, 9.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Pencahayaan
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(8, 16, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x38bdf8, 2, 8);
    pointLight.position.set(0, 2, 0);
    scene.add(pointLight);
    pointerLightRef.current = pointLight;

    // Base Pedestal / Alas Papan 3D
    const boardGeo = new THREE.BoxGeometry(8.2, 0.4, 8.2);
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.35,
      metalness: 0.6,
    });
    const boardMesh = new THREE.Mesh(boardGeo, boardMat);
    boardMesh.position.y = -0.22;
    boardMesh.receiveShadow = true;
    scene.add(boardMesh);

    // Grid 9x9 Balok Sudoku
    const tiles: TileMeta[] = [];
    const tileSize = 0.72;
    const tileHeight = 0.25;
    const tileGeo = new THREE.BoxGeometry(tileSize, tileHeight, tileSize);

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        // Gap ekstra untuk membedakan blok 3x3
        const xOffset = (c - 4) * (tileSize + 0.08) + (Math.floor(c / 3) - 1) * 0.12;
        const zOffset = (r - 4) * (tileSize + 0.08) + (Math.floor(r / 3) - 1) * 0.12;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 4;

        const sideMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.5, metalness: 0.2 });
        const topMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.2, metalness: 0.1 });

        // Urutan Face Material: right, left, top, bottom, front, back
        const materials = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
        const mesh = new THREE.Mesh(tileGeo, materials);
        mesh.position.set(xOffset, 0, zOffset);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { row: r, col: c };

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
          material: topMat
        };

        tiles.push(tileMeta);
        updateTileTexture(tileMeta);
      }
    }
    tilesRef.current = tiles;

    // Raycaster untuk Interaksi Mouse
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(tiles.map(t => t.mesh));

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const { row, col } = hitMesh.userData;
        hoveredCellRef.current = { row, col };
        if (pointerLightRef.current) {
          pointerLightRef.current.position.set(hitMesh.position.x, 1.2, hitMesh.position.z);
        }
      } else {
        hoveredCellRef.current = null;
      }
    };

    const onPointerDown = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(tiles.map(t => t.mesh));

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const { row, col } = hitMesh.userData;
        handleCellClick(row, col);
      }
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('mousemove', onPointerMove);
    domElement.addEventListener('pointerdown', onPointerDown);

    // Animasi & Render Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      tiles.forEach(tile => {
        const isSelected = selectedCell?.row === tile.row && selectedCell?.col === tile.col;
        const isHovered = hoveredCellRef.current?.row === tile.row && hoveredCellRef.current?.col === tile.col;

        // Elevasi dinamis
        if (isSelected) {
          tile.targetY = 0.28;
        } else if (isHovered) {
          tile.targetY = 0.12;
        } else {
          tile.targetY = 0;
        }

        // Interpolasi perpindahan Y (Lerp)
        tile.currentY += (tile.targetY - tile.currentY) * (delta * 14);
        tile.mesh.position.y = tile.currentY;

        // Animasi Shake jika ada kesalahan
        if (tile.shakeTime > 0) {
          tile.shakeTime -= delta;
          tile.mesh.position.x += Math.sin(clock.getElapsedTime() * 40) * 0.03;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    // Resize Observer
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
        t.mesh.geometry.dispose();
        t.texture.dispose();
        if (Array.isArray(t.mesh.material)) {
          t.mesh.material.forEach(m => m.dispose());
        } else {
          t.mesh.material.dispose();
        }
      });

      boardGeo.dispose();
      boardMat.dispose();
      renderer.dispose();
      if (container.contains(domElement)) {
        container.removeChild(domElement);
      }
    };
  }, [handleCellClick, selectedCell, updateTileTexture]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full aspect-square max-w-[620px] rounded-2xl relative overflow-hidden select-none cursor-pointer shadow-2xl transition-all duration-300",
        isStunned && "opacity-50 grayscale",
        className
      )}
    />
  );
};
