export interface RefreshRequest {
  full?: boolean;
  paths?: Iterable<string>;
  memo?: boolean;
  activity?: boolean;
  calendar?: boolean;
  diagnostics?: boolean;
}
export interface RefreshBatch {
  full: boolean;
  paths: Set<string>;
  memo: boolean;
  activity: boolean;
  calendar: boolean;
  diagnostics: boolean;
}
const empty = (): RefreshBatch => ({ full: false, paths: new Set(), memo: false, activity: false, calendar: false, diagnostics: false });
function merge(target: RefreshBatch, request: RefreshRequest): void {
  for (const path of request.paths ?? []) target.paths.add(path);
  for (const key of ["full", "memo", "activity", "calendar", "diagnostics"] as const) target[key] ||= Boolean(request[key]);
}
function hasWork(batch: RefreshBatch): boolean {
  return batch.paths.size > 0 || batch.full || batch.memo || batch.activity || batch.calendar || batch.diagnostics;
}

/** One writer; events arriving during a run belong to the next batch.
 * Failed work stays dirty until an explicit retry or the next event. */
export class RefreshCoordinator {
  private pending = empty();
  private running?: Promise<void>;
  private timer?: number;
  private closed = false;
  private readonly timers = window;
  constructor(private readonly execute: (batch: RefreshBatch) => Promise<void>, private readonly publish: () => void = () => {}) {}

  request(request: RefreshRequest): Promise<void> {
    if (this.closed) return Promise.resolve();
    merge(this.pending, request);
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) {
      // Start on a microtask so requests in the same turn coalesce.
      this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = undefined; });
    }
    return this.running;
  }

  schedule(request: RefreshRequest, onError: (error: unknown) => void, delay = 350): void {
    if (this.closed) return;
    merge(this.pending, request);
    if (this.running) return;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      void this.request({}).catch(onError);
    }, delay);
  }

  dispose(): void {
    this.closed = true;
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = empty();
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      if (!hasWork(this.pending)) {
        this.publish();
        if (!hasWork(this.pending)) return;
      }
      const batch = this.pending;
      this.pending = empty();
      try { await this.execute(batch); }
      catch (error) {
        if (!this.closed) merge(this.pending, batch);
        throw error;
      }
    }
  }
}
