import { useEffect, useState } from 'react';

/**
 * Local form state that follows the server copy. Fresh server data (say, the AI
 * filling in fields) flows in automatically — unless the person has unsaved
 * edits, in which case `serverChanged` lets the form offer to load it.
 */
export function useSyncedForm<T extends Record<string, unknown>>(server: T) {
  const [values, setValues] = useState<T>(server);
  const [baseline, setBaseline] = useState<T>(server);
  const keys = Object.keys(server) as (keyof T)[];
  const dirtyKeys = keys.filter((k) => !Object.is(values[k], baseline[k]));
  const dirty = dirtyKeys.length > 0;
  const serverChanged = keys.some((k) => !Object.is(server[k], baseline[k]));

  useEffect(() => {
    if (serverChanged && !dirty) {
      setValues(server);
      setBaseline(server);
    }
  }, [server, serverChanged, dirty]);

  return {
    values,
    dirty,
    dirtyKeys,
    serverChanged,
    set: <K extends keyof T>(key: K, value: T[K]) => setValues((s) => ({ ...s, [key]: value })),
    undo: () => setValues(baseline),
    loadServer: () => {
      setValues(server);
      setBaseline(server);
    },
    markSaved: (next: T) => {
      setValues(next);
      setBaseline(next);
    },
    changes: (): Partial<T> => Object.fromEntries(dirtyKeys.map((k) => [k, values[k]])) as Partial<T>,
  };
}
