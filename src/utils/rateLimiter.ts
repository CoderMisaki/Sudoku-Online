class ActionRateLimiter {
  private lastActionTime: number = 0;
  private actionCount: number = 0;
  private readonly cooldownMs: number = 150; // Minimal interval 150ms per move (kecepatan maksimal manusia)

  public checkAllowed(): boolean {
    const now = Date.now();
    const timeDiff = now - this.lastActionTime;

    if (timeDiff < this.cooldownMs) {
      this.actionCount++;
      if (this.actionCount > 3) {
        console.warn('Anti-Cheat: Terdeteksi perintah terlalu cepat (Bot/Script)!');
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
