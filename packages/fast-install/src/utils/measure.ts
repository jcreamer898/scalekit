import { performance } from "perf_hooks";

/**
 * Call at the beginning of a long running task, returns a funtion to call which returns total execution time
 */
export const measure = () => {
  const now = performance.now();
  return () => {
    const end = performance.now();
    return Math.round(end - now);
  };
};
