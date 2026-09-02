// One cursor-paginated list, with the races already handled.
//
// The feed and the comment thread each grew their own copy of this state machine, and the
// places where the two copies had drifted are exactly where the bugs were: the feed learned to
// debounce loadMore, comments never did, so two taps appended the same page twice; and neither
// guarded a refresh landing while a loadMore was in flight, which appends a stale page onto a
// fresh list and leaves the cursor pointing into the old snapshot.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../errors";

/** A page of anything, as every paginated endpoint here returns it. */
export type Page<T> = { items: T[]; nextCursor: string | null; hasNext: boolean };

export type CursorPage<T> = {
  items: T[];
  /** First load only. Refreshes and page fetches have their own flags. */
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  /** A failed first load — there is nothing on screen behind it. */
  error: string | null;
  /** A failed page fetch, with items already on screen. Kept apart on purpose. */
  pageError: string | null;
  hasNext: boolean;
  /** Reload from the top, replacing everything. */
  reload: (options?: { pull?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  /** For optimistic updates — the feed rewrites a row's like state through this. */
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
};

export function useCursorPage<T>(
  fetchPage: (cursor?: string | null) => Promise<Page<T>>,
  /** Runs after a reload replaces the list — the feed uses it to return to the top. */
  onReloaded?: () => void
): CursorPage<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Bumped by every reload. A page fetch that started before the current generation is
  // answering about a list that no longer exists, so its result is dropped rather than
  // concatenated onto the new one.
  const generation = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const reload = useCallback(async ({ pull = false } = {}) => {
    const mine = ++generation.current;
    setError(null);
    setPageError(null);
    // Set, not merely cleared: without this a retry tap fires a request with no visible
    // feedback at all and reads as a dead button.
    if (pull) setRefreshing(true);
    else setLoading(true);
    try {
      const page = await fetchRef.current();
      if (generation.current !== mine) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setHasNext(page.hasNext);
      onReloaded?.();
    } catch (e) {
      if (generation.current === mine) setError(errorMessage(e));
    } finally {
      if (generation.current === mine) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // onReloaded is intentionally not a dependency: callers pass an inline arrow, and
    // depending on it would rebuild reload every render and re-fire the mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    // loadingMore also debounces: onEndReached fires repeatedly during a fast flick, and a
    // "load more" button can be tapped twice before the first request answers.
    if (!hasNext || loadingMore || loading || !cursor) return;
    const mine = generation.current;
    setLoadingMore(true);
    setPageError(null);
    try {
      const page = await fetchRef.current(cursor);
      if (generation.current !== mine) return;
      // Concatenate rather than replace: scrolling back must keep working.
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setHasNext(page.hasNext);
    } catch (e) {
      if (generation.current === mine) setPageError(errorMessage(e));
    } finally {
      if (generation.current === mine) setLoadingMore(false);
    }
  }, [cursor, hasNext, loading, loadingMore]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    pageError,
    hasNext,
    reload,
    loadMore,
    setItems,
  };
}
