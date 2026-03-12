export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private maxPerMinute: number,
    private concurrency: number = 3,
  ) {}

  async acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const minInterval = 60_000 / this.maxPerMinute;

    setTimeout(() => {
      const next = this.queue.shift();
      if (next) next();
    }, minInterval);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
