import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '../utils/formatters';

// Load-once + pull-to-refresh state for a screen. `fetcher` returns a promise
// resolving to the data (not the axios response); re-runs when it changes, so
// wrap it in useCallback with its real dependencies.
export default function useApiData(fetcher, errorText) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const run = useCallback(async () => {
    const call = ++latest.current;
    try {
      const result = await fetcher();
      if (call !== latest.current) return; // a newer load superseded this one
      setData(result);
      setError('');
    } catch (err) {
      if (call !== latest.current) return;
      setError(errorMessage(err, errorText));
    } finally {
      if (call === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [fetcher, errorText]);

  useEffect(() => {
    setLoading(true);
    run();
  }, [run]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    run();
  }, [run]);

  return { data, loading, refreshing, error, refresh };
}
