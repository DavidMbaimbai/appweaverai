export type SaveState = 'saving' | 'saved' | 'error';

const SAVE_STATE_EVENT = 'aw:save-state';

let inFlight = 0;

function emit(state: SaveState) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SaveState>(SAVE_STATE_EVENT, { detail: state }));
}

/**
 * Wraps any editor operation that changes the project so the save pill
 * shows "Saving…" while it runs, then "Saved" or "Error". Several overlapping
 * operations stay in "Saving…" until the last one finishes.
 */
export async function trackSave<T>(
  operation: Promise<T>,
  failed: (result: T) => boolean = (result) =>
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    Boolean((result as { error?: unknown }).error),
): Promise<T> {
  inFlight += 1;
  emit('saving');
  try {
    const result = await operation;
    inFlight -= 1;
    if (inFlight === 0) emit(failed(result) ? 'error' : 'saved');
    return result;
  } catch (error) {
    inFlight -= 1;
    if (inFlight === 0) emit('error');
    throw error;
  }
}

export function subscribeSaveState(listener: (state: SaveState) => void) {
  function handle(event: Event) {
    listener((event as CustomEvent<SaveState>).detail);
  }
  window.addEventListener(SAVE_STATE_EVENT, handle);
  return () => window.removeEventListener(SAVE_STATE_EVENT, handle);
}
