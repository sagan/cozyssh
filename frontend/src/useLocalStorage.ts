import { useState, useEffect, useCallback, useRef } from "react";
import { EVENT_LOCAL_STORAGE_SYNC } from "./constants";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const initialValueRef = useRef(initialValue);

  // Check if T is a string at runtime based on the initial value
  const isStringType = typeof initialValueRef.current === "string";

  const readValue = useCallback((): T => {
    if (typeof window === "undefined") {
      return initialValueRef.current;
    }
    try {
      const item = window.localStorage.getItem(key);
      if (item === null) {
        return initialValueRef.current;
      }

      // If it's a string, return it directly without JSON.parse
      return isStringType ? (item as unknown as T) : (JSON.parse(item) as T);
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValueRef.current;
    }
  }, [key, isStringType]);

  // Initialize state immediately using the readValue function
  const [storedValue, setStoredValue] = useState<T>(() => readValue());

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        setStoredValue((prev) => {
          const valueToStore = value instanceof Function ? value(prev) : value;

          if (typeof window !== "undefined") {
            // Avoid JSON.stringify if dealing with a raw string
            const serializedValue = isStringType
              ? (valueToStore as unknown as string)
              : JSON.stringify(valueToStore);

            window.localStorage.setItem(key, serializedValue);
            window.dispatchEvent(new Event(EVENT_LOCAL_STORAGE_SYNC));
          }

          return valueToStore;
        });
      } catch (error) {
        console.warn(`Error setting localStorage key “${key}”:`, error);
      }
    },
    [key, isStringType]
  );

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key) {
        if (!e.newValue) {
          setStoredValue(initialValueRef.current);
        } else {
          // Sync correctly across tabs depending on type
          setStoredValue(
            isStringType ? (e.newValue as unknown as T) : JSON.parse(e.newValue)
          );
        }
      }
    };

    const handleSameTabSync = () => {
      setStoredValue(readValue());
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(EVENT_LOCAL_STORAGE_SYNC, handleSameTabSync);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(EVENT_LOCAL_STORAGE_SYNC, handleSameTabSync);
    };
  }, [key, readValue, isStringType]);

  return [storedValue, setValue] as const;
}
