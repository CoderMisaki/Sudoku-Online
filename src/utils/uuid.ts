export function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return '';

  const STORED_ID_KEY = 'sudoku_user_id';
  let userId = localStorage.getItem(STORED_ID_KEY);

  if (!userId) {
    userId = generateUUID();
    localStorage.setItem(STORED_ID_KEY, userId);
  }

  return userId;
}
