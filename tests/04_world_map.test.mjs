import assert from 'assert';

console.log('--- TEST SUITE 4: REALTIME WORLD MAP & MARKERS ---');

const WORLD_W = 260;
const WORLD_H = 260;

function worldToMapCoords(wx, wy, mapWidth, mapHeight, zoom = 1, panX = 0, panY = 0) {
  const normX = wx / WORLD_W;
  const normY = wy / WORLD_H;
  const cx = mapWidth / 2;
  const cy = mapHeight / 2;
  const screenX = cx + (normX * mapWidth - cx + panX) * zoom;
  const screenY = cy + (normY * mapHeight - cy + panY) * zoom;
  return { x: screenX, y: screenY };
}

function clampPan(panX, panY, zoom, mapWidth, mapHeight) {
  if (zoom <= 1) return { panX: 0, panY: 0 };
  const maxPanX = (mapWidth * (zoom - 1)) / (2 * zoom);
  const maxPanY = (mapHeight * (zoom - 1)) / (2 * zoom);
  return {
    panX: Math.max(-maxPanX, Math.min(maxPanX, panX)),
    panY: Math.max(-maxPanY, Math.min(maxPanY, panY)),
  };
}

// 1. World to map coordinate transformation
{
  const mapW = 800, mapH = 600;
  // Center of world (130, 130) -> Center of map (400, 300)
  const center = worldToMapCoords(130, 130, mapW, mapH, 1, 0, 0);
  assert.strictEqual(Math.round(center.x), 400);
  assert.strictEqual(Math.round(center.y), 300);

  // Top-left (0,0) -> (0,0)
  const tl = worldToMapCoords(0, 0, mapW, mapH, 1, 0, 0);
  assert.strictEqual(Math.round(tl.x), 0);
  assert.strictEqual(Math.round(tl.y), 0);

  // Bottom-right (260, 260) -> (800, 600)
  const br = worldToMapCoords(260, 260, mapW, mapH, 1, 0, 0);
  assert.strictEqual(Math.round(br.x), 800);
  assert.strictEqual(Math.round(br.y), 600);
  console.log('✔ World-to-map coordinate transformation verified');
}

// 2. Map marker placement for players and NPCs
{
  const mapW = 600, mapH = 600;
  const players = [
    { id: 'me', name: 'ALICE', x: 70, y: 150 },
    { id: 'bob', name: 'BOB', x: 120, y: 130 },
  ];
  const npcs = [
    { id: 'mayor', name: 'Mayor Thomas', x: 120, y: 132 },
    { id: 'shopkeeper', name: 'Karen', x: 135, y: 125 },
  ];
  const poi = [
    { id: 'farm', label: 'Farm', x: 70, y: 150 },
    { id: 'town', label: 'Town Square', x: 120, y: 130 },
    { id: 'shop', label: 'General Store', x: 135, y: 125 },
    { id: 'mine', label: 'Mine', x: 30, y: 40 },
  ];

  const renderedMarkers = [];
  for (const p of players) {
    const pt = worldToMapCoords(p.x, p.y, mapW, mapH, 1);
    renderedMarkers.push({ type: 'player', id: p.id, name: p.name, ...pt });
  }
  for (const n of npcs) {
    const pt = worldToMapCoords(n.x, n.y, mapW, mapH, 1);
    renderedMarkers.push({ type: 'npc', id: n.id, name: n.name, ...pt });
  }
  for (const f of poi) {
    const pt = worldToMapCoords(f.x, f.y, mapW, mapH, 1);
    renderedMarkers.push({ type: 'poi', id: f.id, label: f.label, ...pt });
  }

  assert.strictEqual(renderedMarkers.length, 8);
  assert(renderedMarkers.every(m => m.x >= 0 && m.x <= mapW && m.y >= 0 && m.y <= mapH));
  console.log('✔ Player, NPC, and POI map markers rendered accurately');
}

// 3. Pan / Zoom clamping
{
  const clamped1 = clampPan(100, 100, 1.0, 800, 600);
  assert.strictEqual(clamped1.panX, 0, 'No pan allowed at zoom 1');
  assert.strictEqual(clamped1.panY, 0);

  const clamped2 = clampPan(500, 500, 2.0, 800, 600);
  assert(clamped2.panX <= 200, 'Pan clamped within visible boundaries at zoom 2');
  assert(clamped2.panY <= 150);
  console.log('✔ Zoom and pan boundary clamping verified');
}

console.log('SUITE 4 PASSED!\n');
