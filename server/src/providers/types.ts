/** Provider-agnostic contract for the agent chat backend. */

export type AgentEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'status'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'message'; text: string }
  | { type: 'usage'; input: number; output: number; cached?: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface RunOptions {
  prompt: string;
  /** Absolute path to the session workspace containing diagram.mmd. */
  workspace: string;
  /** Provider thread id from a previous turn, when continuing a conversation. */
  threadId?: string;
  model?: string;
  signal: AbortSignal;
}

export interface Provider {
  id: string;
  label: string;
  /** Auth/availability check surfaced in the UI. */
  status(): Promise<{ ok: boolean; detail: string }>;
  models(): string[];
  run(opts: RunOptions, emit: (event: AgentEvent) => void): Promise<void>;
}
