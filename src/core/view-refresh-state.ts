/** Keeps only the latest snapshot while a page is hidden or editing. */
export class ViewRefreshState<T> {
  private pending?: { value: T };
  private closed = false;
  constructor(private readonly publish: (value: T) => void) {}
  offer(value: T, visible: boolean, editing = false): void {
    if (this.closed) return;
    this.pending = { value };
    this.flush(visible, editing);
  }
  flush(visible: boolean, editing = false): void {
    if (this.closed || !visible || editing || !this.pending) return;
    const value = this.pending.value;
    this.pending = undefined;
    this.publish(value);
  }
  dispose(): void { this.closed = true; this.pending = undefined; }
}
