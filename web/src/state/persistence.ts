export type SaveStatus =
  | { state: 'saved' }
  | { state: 'saving' }
  | { state: 'error'; message: string };

interface SessionSlot {
  latestSource: string;
  version: number;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
  status: SaveStatus;
}

interface PersistenceOptions {
  delayMs?: number;
  onStatus?: (sessionId: string, status: SaveStatus) => void;
}

export function createDiagramPersistence(
  save: (sessionId: string, source: string) => Promise<unknown>,
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

  const arm = (sessionId: string, slot: SessionSlot) => {
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
          await save(sessionId, source);
        } catch (error) {
          slot.dirty = true;
          failedVersion = version;
          setStatus(sessionId, slot, {
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
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
        arm(sessionId, slot);
      }
    }
  };

  return {
    schedule(sessionId: string, source: string): void {
      const slot = slotFor(sessionId);
      slot.latestSource = source;
      slot.version += 1;
      slot.dirty = true;
      setStatus(sessionId, slot, { state: 'saving' });
      if (!slot.inFlight) arm(sessionId, slot);
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
