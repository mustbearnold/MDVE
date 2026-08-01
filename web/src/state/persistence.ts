import { ApiError } from '../api';

export type SaveStatus =
  | { state: 'saved'; historyAvailable?: boolean }
  | { state: 'saving' }
  | { state: 'error'; message: string }
  | { state: 'conflict'; message: string; currentSource: string; actualRevision: number };

interface SessionSlot {
  latestSource: string;
  baseRevision?: number;
  version: number;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
  status: SaveStatus;
}

interface PersistenceOptions {
  delayMs?: number;
  onStatus?: (sessionId: string, status: SaveStatus) => void;
  onSaved?: (sessionId: string, result: unknown) => void;
}

export function createDiagramPersistence(
  save: (sessionId: string, source: string, expectedRevision?: number) => Promise<unknown>,
  options: PersistenceOptions = {},
) {
  const delayMs = options.delayMs ?? 250;
  const slots = new Map<string, SessionSlot>();

  const slotFor = (sessionId: string): SessionSlot => {
    let slot = slots.get(sessionId);
    if (!slot) {
      slot = { latestSource: '', version: 0, dirty: false, status: { state: 'saved' } };
      slots.set(sessionId, slot);
    }
    return slot;
  };

  const setStatus = (sessionId: string, slot: SessionSlot, status: SaveStatus) => {
    slot.status = status;
    options.onStatus?.(sessionId, status);
  };

  const scheduleDrain = (sessionId: string, slot: SessionSlot) => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      slot.timer = undefined;
      void drain(sessionId);
    }, delayMs);
  };

  const drain = async (sessionId: string): Promise<void> => {
    const slot = slots.get(sessionId);
    if (!slot) return;
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = undefined;
    }
    if (slot.inFlight) return slot.inFlight;
    if (!slot.dirty) return;

    let failedVersion: number | undefined;
    const work = (async () => {
      while (slot.dirty) {
        slot.dirty = false;
        const source = slot.latestSource;
        const version = slot.version;
        setStatus(sessionId, slot, { state: 'saving' });

        try {
          const result = await save(sessionId, source, slot.baseRevision);
          if (result && typeof result === 'object' && 'revision' in result && typeof result.revision === 'number') {
            slot.baseRevision = result.revision;
          }
          options.onSaved?.(sessionId, result);
        } catch (error) {
          slot.dirty = true;
          failedVersion = version;
          if (
            error instanceof ApiError &&
            error.status === 409 &&
            error.payload &&
            typeof error.payload === 'object' &&
            'source' in error.payload &&
            typeof error.payload.source === 'string' &&
            'revision' in error.payload &&
            typeof error.payload.revision === 'number'
          ) {
            setStatus(sessionId, slot, {
              state: 'conflict',
              message: error.message,
              currentSource: error.payload.source,
              actualRevision: error.payload.revision,
            });
          } else {
            setStatus(sessionId, slot, {
              state: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
      }

      setStatus(sessionId, slot, { state: 'saved' });
    })();

    slot.inFlight = work;
    try {
      await work;
    } finally {
      slot.inFlight = undefined;
      // A newer edit may have arrived while a failed request was in flight.
      // Retry that new version after the normal debounce, but do not loop on
      // the same failed payload until the user explicitly retries.
      if (slot.dirty && failedVersion !== undefined && slot.version > failedVersion) {
        scheduleDrain(sessionId, slot);
      }
    }
  };

  return {
    seed(sessionId: string, revision: number): void {
      const slot = slotFor(sessionId);
      slot.baseRevision = revision;
    },

    schedule(sessionId: string, source: string): void {
      const slot = slotFor(sessionId);
      slot.latestSource = source;
      slot.version += 1;
      slot.dirty = true;
      setStatus(sessionId, slot, { state: 'saving' });
      if (!slot.inFlight) scheduleDrain(sessionId, slot);
    },

    flush(sessionId: string): Promise<void> {
      return drain(sessionId);
    },

    retry(sessionId: string): Promise<void> {
      return drain(sessionId);
    },

    status(sessionId: string): SaveStatus {
      return slots.get(sessionId)?.status ?? { state: 'saved' };
    },

    dispose(): void {
      for (const slot of slots.values()) {
        if (slot.timer) clearTimeout(slot.timer);
      }
      slots.clear();
    },
  };
}
