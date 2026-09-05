"use client";

import React from 'react';
import { useParams } from 'next/navigation';
import { HarvestMoonGame } from '@/harvest/HarvestMoonGame';

export default function HarvestRoomPage() {
  const params = useParams();
  const roomId = String(params?.roomId || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white bg-[#101a2e] text-sm">
        Kode world tidak valid.
      </div>
    );
  }
  return <HarvestMoonGame roomId={roomId} />;
}
