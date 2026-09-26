import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

/**
 * Lets the card page see which panels have unsaved edits, so actions like
 * "Approve & next" can save them first instead of silently dropping them.
 */
interface PendingEdit {
  label: string;
  /** Saves the edits; resolves false if saving failed (the panel shows the error). */
  save: () => Promise<boolean>;
}

interface Registry {
  set: (id: string, edit: PendingEdit | null) => void;
  pending: () => PendingEdit[];
}

const UnsavedContext = createContext<Registry | null>(null);

export function UnsavedEditsProvider({ children, registry }: { children: ReactNode; registry: Registry }) {
  return <UnsavedContext.Provider value={registry}>{children}</UnsavedContext.Provider>;
}

export function useUnsavedEditsRegistry(): Registry {
  const edits = useRef(new Map<string, PendingEdit>());
  const set = useCallback((id: string, edit: PendingEdit | null) => {
    if (edit) edits.current.set(id, edit);
    else edits.current.delete(id);
  }, []);
  const pending = useCallback(() => [...edits.current.values()], []);
  return useMemo(() => ({ set, pending }), [set, pending]);
}

/** Called by a panel with a form: reports whether it has unsaved edits and how to save them. */
export function useReportUnsaved(id: string, label: string, dirty: boolean, save: () => Promise<boolean>): void {
  const registry = useContext(UnsavedContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!registry) return;
    registry.set(id, dirty ? { label, save: () => saveRef.current() } : null);
    return () => registry.set(id, null);
  }, [registry, id, label, dirty]);
}
