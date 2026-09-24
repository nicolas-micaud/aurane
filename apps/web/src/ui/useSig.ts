import { useEffect, useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';

/** Explicit subscription to a signal: re-renders the component when it changes. */
export function useSig<T>(sig: Signal<T>): T {
  const [value, setValue] = useState<T>(sig.value);
  useEffect(() => sig.subscribe((v) => setValue(() => v)), [sig]);
  return value;
}
