/** Read-only localhost SDK. Serve your web client over http://localhost, not file://. */
export class FactoryApiClient {
  constructor(baseUrl = 'http://127.0.0.1:17840', { interval = 500, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.interval = interval;
    this.fetch = fetchImpl.bind(globalThis);
    this.running = false;
  }
  async request(path, signal) {
    const timeout = new AbortController();
    const cancel = () => timeout.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) timeout.abort();
    const timer = setTimeout(cancel, 5000);
    try {
      const response = await this.fetch(this.baseUrl + path, { signal: timeout.signal, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error?.message || `HTTP ${response.status}`), { status: response.status, code: body.error?.code });
      return body;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  health(signal) { return this.request('/api/v1/health', signal); }
  catalog(signal) { return this.request('/api/v1/catalog', signal); }
  snapshot(sections, signal) {
    return this.request('/api/v1/snapshot' + (sections ? '?sections=' + encodeURIComponent(sections.join(',')) : ''), signal);
  }
  changes(cursor, signal) {
    return this.request(`/api/v1/changes?after=${cursor.revision}&instanceId=${encodeURIComponent(cursor.instanceId)}`, signal);
  }
  /** One loop, no overlapping requests; initial/reconnect always refreshes the complete selection. */
  watch({ sections = ['session', 'research', 'unlocks', 'upgrades', 'resources', 'economy', 'factory', 'progression'], onSnapshot, onStatus = () => {} }) {
    if (this.running) throw new Error('Already watching');
    if (typeof onSnapshot !== 'function') throw new Error('onSnapshot is required');
    this.running = true;
    const controller = new AbortController();
    let timer, wake;
    const sleep = ms => new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, ms); });
    const stop = () => { controller.abort(); clearTimeout(timer); wake?.(); };
    const emitStatus = value => { try { onStatus(value); } catch { /* Consumer errors must not break reconnect. */ } };
    const task = (async () => {
      let cursor = null, failures = 0;
      while (!controller.signal.aborted) {
        try {
          const health = await this.health(controller.signal);
          if (health.stale || health.status === 'error') throw new Error(health.error || 'Game samples are stale');
          let shouldRead = !cursor, changed = null;
          if (cursor) {
            const feed = await this.changes(cursor, controller.signal);
            shouldRead = feed.resyncRequired || feed.changes.some(c => c.sections.some(s => sections.includes(s)));
            changed = [...new Set(feed.changes.flatMap(c => c.sections))];
            if (!shouldRead) cursor = { instanceId: feed.instanceId, revision: feed.revision };
          }
          if (shouldRead) {
            const snapshot = await this.snapshot(sections, controller.signal);
            if (controller.signal.aborted) break;
            await onSnapshot(snapshot, changed);
            cursor = { instanceId: snapshot.instanceId, revision: snapshot.revision };
          }
          failures = 0; emitStatus({ connected: true, health });
          await sleep(this.interval);
        } catch (error) {
          if (controller.signal.aborted) break;
          cursor = null; failures++;
          emitStatus({ connected: false, error });
          await sleep(Math.min(5000, this.interval * 2 ** Math.min(failures, 4)));
        }
      }
    })().finally(() => { this.running = false; });
    return { stop, done: task };
  }
}
