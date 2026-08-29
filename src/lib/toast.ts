/**
 * toast.ts — app-wide transient notifications.
 *
 * Why this exists: every page owned its own error state and rendered it as a
 * banner near the top of the page. On a long page (the review queue is the
 * worst case) an action at the bottom would set an error the user never saw —
 * the Send button appeared to do nothing at all. Notifications are now surfaced
 * in a fixed overlay that is visible wherever the user is scrolled to.
 *
 * A plain module-level store rather than React context: `apiFetch` (a non-React
 * function in src/lib/client.ts) is the main producer, so notifications have to
 * be pushable from outside the component tree. <ToastHost /> subscribes via
 * useSyncExternalStore and is mounted once in the root layout.
 *
 * Client-side only. Pushing during SSR is a no-op-ish (the store would be
 * per-request module state), which is why getServerToasts() always returns the
 * same frozen empty array — that keeps useSyncExternalStore's snapshot stable
 * and hydration quiet.
 */

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  /** Short mono kicker, e.g. "ACTION FAILED". */
  title: string;
  /** The detail the user needs — usually the server's error string. */
  message: string;
}

/** Newest wins; older ones fall off so the stack can't cover the screen. */
const MAX_VISIBLE = 4;

/**
 * Errors never auto-dismiss: the whole point is that the user gets to read
 * what went wrong. Successes are confirmations and can fade on their own.
 */
const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  error: null,
  success: 4500,
  info: 6000,
};

const EMPTY: Toast[] = [];

let toasts: Toast[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for useSyncExternalStore — reference changes only on mutation. */
export function getToasts(): Toast[] {
  return toasts;
}

export function getServerToasts(): Toast[] {
  return EMPTY;
}

export function dismissToast(id: number): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function dismissAllToasts(): void {
  if (toasts.length === 0) return;
  toasts = EMPTY;
  emit();
}

export function pushToast(kind: ToastKind, title: string, message: string): number {
  // Collapse repeats: a retry loop or a re-rendering page can push the same
  // failure many times, and four copies of one message is just noise.
  const duplicate = toasts.find((t) => t.kind === kind && t.message === message);
  if (duplicate) return duplicate.id;

  const id = nextId++;
  toasts = [...toasts, { id, kind, title, message }].slice(-MAX_VISIBLE);
  emit();

  const ttl = AUTO_DISMISS_MS[kind];
  if (ttl !== null && typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), ttl);
  }
  return id;
}

export function toastError(message: string, title = "SOMETHING WENT WRONG"): number {
  return pushToast("error", title, message);
}

export function toastSuccess(message: string, title = "DONE"): number {
  return pushToast("success", title, message);
}

export function toastInfo(message: string, title = "HEADS UP"): number {
  return pushToast("info", title, message);
}
