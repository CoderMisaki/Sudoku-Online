const AVATAR_KEY = 'sudoku_avatar';
const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB pre-process reject
const AVATAR_TARGET_PX = 128;
const AVATAR_JPEG_QUALITY = 0.75;
const AVATAR_MAX_DATA_URL_CHARS = 180_000; // ~135KB binary
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const ALLOWED_DATA_URL_PREFIXES = ['data:image/jpeg;', 'data:image/png;', 'data:image/webp;'];

// ─── LocalStorage ───
export function getStoredAvatar(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(AVATAR_KEY);
    if (!v || v === 'null' || v === 'undefined') return null;
    if (!isSafeDataUrl(v)) {
      // Auto-purge poisoned entry (possible XSS attempt or corrupt)
      try { localStorage.removeItem(AVATAR_KEY); } catch {}
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function setStoredAvatar(dataUrl: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (dataUrl === null) {
      localStorage.removeItem(AVATAR_KEY);
      return true;
    }
    if (!isSafeDataUrl(dataUrl)) return false;
    // Guard storage quota before write
    if (dataUrl.length > AVATAR_MAX_DATA_URL_CHARS) return false;
    localStorage.setItem(AVATAR_KEY, dataUrl);
    return true;
  } catch (e) {
    console.warn('[avatar] localStorage save failed', e);
    return false;
  }
}

export function isSafeDataUrl(v: string): boolean {
  if (typeof v !== 'string') return false;
  if (v.length > AVATAR_MAX_DATA_URL_CHARS) return false;
  // Strict allowlist: only jpeg/png/webp data URLs produced by our canvas
  const okPrefix = ALLOWED_DATA_URL_PREFIXES.some((p) => v.startsWith(p));
  if (!okPrefix) return false;
  // Must be base64
  if (!v.includes(';base64,')) return false;
  // Reject embedded scripts / HTML / SVG payloads
  const lower = v.toLowerCase();
  if (lower.includes('<script') || lower.includes('javascript:') || lower.includes('data:text/html') || lower.includes('<svg') || lower.includes('onload=') || lower.includes('onerror=')) return false;
  // Basic base64 charset check (header already validated)
  const b64 = v.split(';base64,')[1] || '';
  if (b64.length === 0) return false;
  if (/[^A-Za-z0-9+/=]/.test(b64.slice(0, 100))) return false; // sample check
  return true;
}

// ─── Validation ───
export function validateImageFile(file: File): string | null {
  // Block SVG and other executable image types explicitly
  const typeLower = (file.type || '').toLowerCase();
  if (typeLower === 'image/svg+xml' || typeLower.includes('svg')) return 'Format SVG tidak diizinkan (risiko script).';
  if (!file.type.startsWith('image/')) return 'File harus berupa gambar (image/*).';
  if (!ALLOWED_MIME.has(typeLower)) return `Tipe gambar tidak didukung (${file.type}). Gunakan JPG/PNG/WebP/GIF/BMP.`;
  if (file.size > AVATAR_MAX_FILE_BYTES) return `File terlalu besar (max ${Math.round(AVATAR_MAX_FILE_BYTES / 1024 / 1024)}MB).`;
  if (file.size < 32) return 'File terlalu kecil/corrupt.';
  const nameLower = (file.name || '').toLowerCase();
  if (nameLower.endsWith('.svg') || nameLower.endsWith('.svgz') || nameLower.endsWith('.html') || nameLower.endsWith('.htm') || nameLower.endsWith('.js')) {
    return 'Ekstensi file tidak diizinkan.';
  }
  return null;
}

async function validateMagicBytes(file: File): Promise<string | null> {
  // Read first 12 bytes to verify file signature (prevent MIME spoofing)
  const slice = file.slice(0, 12);
  const buf: ArrayBuffer = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error('Gagal membaca header file'));
    r.readAsArrayBuffer(slice);
  });
  const bytes = new Uint8Array(buf);
  if (bytes.length < 2) return 'File header tidak valid.';

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return null;
  // GIF: 47 49 46 38 (GIF8)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return null;
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return null;
  // WebP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return null;
    return 'Header WebP tidak valid.';
  }
  // Allow other image types that passed MIME but fail magic? Reject to be safe
  return 'Signature file tidak dikenali (bukan JPG/PNG/WebP/GIF/BMP valid) — kemungkinan file palsu.';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Prevent external fetch / CORS leakage
    img.crossOrigin = 'anonymous';
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar (corrupt atau format tidak didukung)'));
    img.src = src;
  });
}

export async function processAvatarImage(file: File): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  const magicError = await validateMagicBytes(file);
  if (magicError) throw new Error(magicError);

  const rawDataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });

  // Extra guard: raw DataURL must not be SVG / HTML
  const rawLower = rawDataUrl.slice(0, 64).toLowerCase();
  if (rawLower.includes('svg') || rawLower.includes('text/html') || rawLower.includes('application/')) {
    throw new Error('Tipe data mentah tidak diizinkan.');
  }

  const img = await loadImage(rawDataUrl);

  // Guard decoded dimensions
  if (img.width < 8 || img.height < 8) throw new Error('Gambar terlalu kecil');
  if (img.width > 8000 || img.height > 8000) throw new Error('Dimensi gambar terlalu besar');
  // Prevent gigapixel bomb via decoded pixel count
  if (img.width * img.height > 32_000_000) throw new Error('Resolusi gambar melebihi batas.');

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_TARGET_PX;
  canvas.height = AVATAR_TARGET_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak didukung');

  // Cover crop: center, keep aspect ratio
  const scale = Math.max(AVATAR_TARGET_PX / img.width, AVATAR_TARGET_PX / img.height);
  const sw = AVATAR_TARGET_PX / scale;
  const sh = AVATAR_TARGET_PX / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;

  // High quality smoothing
  (ctx as unknown as Record<string, unknown>).imageSmoothingQuality = 'high';
  // Ensure canvas is opaque (prevent transparent trick)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, AVATAR_TARGET_PX, AVATAR_TARGET_PX);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, AVATAR_TARGET_PX, AVATAR_TARGET_PX);

  // Encode as JPEG (strips metadata, neutralizes embedded scripts)
  let out = '';
  try {
    out = canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY);
  } catch {
    out = canvas.toDataURL('image/png');
  }

  if (!isSafeDataUrl(out)) throw new Error('Output encoding tidak aman.');

  // Sanity: limit data URL length
  if (out.length > 150_000) {
    try {
      out = canvas.toDataURL('image/jpeg', 0.6);
    } catch {}
  }
  if (out.length > AVATAR_MAX_DATA_URL_CHARS) {
    throw new Error('Hasil kompresi masih terlalu besar');
  }
  if (!isSafeDataUrl(out)) throw new Error('Output melebihi batas aman.');

  return out;
}

// For testing / fallback generation: initials
export function getAvatarFallbackLabel(username: string): string {
  const u = (username || '').trim().toUpperCase();
  // Neutral glyph for nameless players — never a fabricated name/initial
  return u.charAt(0) || '?';
}
