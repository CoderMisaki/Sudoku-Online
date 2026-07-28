class ActionRateLimiter {
  private lastActionTime: number = 0;
  private actionCount: number = 0;
  private readonly cooldownMs: number = 40; // 40ms interval (~25 aksi/detik)

  public checkAllowed(): boolean {
    const now = Date.now();
    const timeDiff = now - this.lastActionTime;

    if (timeDiff < this.cooldownMs) {
      this.actionCount++;
      if (this.actionCount > 10) {
        console.warn('Anti-Cheat: Terdeteksi perintah terlalu cepat!');
        return false;
      }
    } else {
      this.actionCount = 0;
    }

    this.lastActionTime = now;
    return true;
  }
}

export const moveRateLimiter = new ActionRateLimiter();
