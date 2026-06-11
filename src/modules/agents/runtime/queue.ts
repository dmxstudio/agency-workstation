/**
 * Minimal run-execution queue interface (agreed decision: in-process async,
 * NO pg-boss/Redis — PGlite is in-process). A real queue can replace the
 * in-process implementation behind this exact interface later; nothing else
 * in the runtime would change.
 *
 * The UI never touches this: it polls run state in the DB. `waitFor` exists
 * for tests/e2e scripts that need to await settlement deterministically.
 */
export interface AgentRunQueue {
  /** Schedules the execution. MUST NOT block the caller (fire-and-forget). */
  enqueue(runId: string, execute: () => Promise<void>): void;
  /** Resolves when the run's execution settles (already-settled ⇒ resolved). */
  waitFor(runId: string): Promise<void>;
}

class InProcessQueue implements AgentRunQueue {
  private readonly pending = new Map<string, Promise<void>>();

  enqueue(runId: string, execute: () => Promise<void>): void {
    const settled = execute()
      // The executor records failures on the run row; an escape here would
      // otherwise become an unhandled rejection that kills the dev server.
      .catch((error) => {
        console.error(`[agents] run ${runId} crashed outside the runner:`, error);
      })
      .finally(() => {
        this.pending.delete(runId);
      });
    this.pending.set(runId, settled);
  }

  waitFor(runId: string): Promise<void> {
    return this.pending.get(runId) ?? Promise.resolve();
  }
}

/**
 * HMR-safe singleton (same pattern as the DB client): Next dev re-evaluates
 * modules, and in-flight runs must survive a reload of this module.
 */
const globalForQueue = globalThis as typeof globalThis & {
  __agencyWorkstationRunQueue?: AgentRunQueue;
};

export function getAgentRunQueue(): AgentRunQueue {
  if (!globalForQueue.__agencyWorkstationRunQueue) {
    globalForQueue.__agencyWorkstationRunQueue = new InProcessQueue();
  }
  return globalForQueue.__agencyWorkstationRunQueue;
}
