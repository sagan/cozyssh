import { useState, useEffect, useCallback, useRef } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  // 1. Prevent infinite loops by storing initialValue in a ref
  const initialValueRef = useRef(initialValue);

  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialValueRef.current;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValueRef.current;
    } catch (error) {
      console.warn(`Error reading localStorage key “${key}”:`, error);
      return initialValueRef.current;
    }
  }, [key]);

  // 2. Prevent SSR hydration errors by always starting with initial value
  const [storedValue, setStoredValue] = useState<T>(initialValueRef.current);

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      // 3. Fix stale closures by using the functional update form
      setStoredValue((prev) => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
          // 4. Dispatch a custom event so other components in the SAME tab sync up
          window.dispatchEvent(new Event('local-storage-sync'));
        }
        
        return valueToStore;
      });
    } catch (error) {
      console.warn(`Error setting localStorage key “${key}”:`, error);
    }
  }, [key]);

  // Hydrate state from localStorage on initial client mount
  useEffect(() => {
    setStoredValue(readValue());
  }, [readValue]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key) {
        // 5. Handle deletion by falling back to initial value if e.newValue is null
        setStoredValue(e.newValue ? JSON.parse(e.newValue) : initialValueRef.current);
      }
    };

    const handleSameTabSync = () => {
      setStoredValue(readValue());
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('local-storage-sync', handleSameTabSync);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('local-storage-sync', handleSameTabSync);
    };
  }, [key, readValue]);

  return [storedValue, setValue] as const;
}