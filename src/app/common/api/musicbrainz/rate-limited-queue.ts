import { Injectable } from '@angular/core';

type Task<T> = () => Promise<T>;

interface QueueEntry {
    task: Task<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

@Injectable({ providedIn: 'root' })
export class RateLimitedQueue {
    private queue: QueueEntry[] = [];
    private isProcessing: boolean = false;
    private lastRunAt: number = 0;
    private minIntervalMs: number = 1100;

    public setMinIntervalMs(ms: number): void {
        this.minIntervalMs = ms;
    }

    public enqueue<T>(task: Task<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                task: task as Task<unknown>,
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            void this.process();
        });
    }

    public size(): number {
        return this.queue.length;
    }

    public clear(): void {
        const drained = this.queue.splice(0, this.queue.length);
        for (const entry of drained) {
            entry.reject(new Error('Queue cleared'));
        }
    }

    private async process(): Promise<void> {
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const entry = this.queue.shift()!;
                const now = Date.now();
                const wait = Math.max(0, this.minIntervalMs - (now - this.lastRunAt));
                if (wait > 0) {
                    await new Promise((resolve) => setTimeout(resolve, wait));
                }

                this.lastRunAt = Date.now();
                try {
                    const result = await entry.task();
                    entry.resolve(result);
                } catch (e) {
                    entry.reject(e);
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }
}
