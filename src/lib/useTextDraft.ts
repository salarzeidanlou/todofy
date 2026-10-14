import { useState } from "preact/hooks";

/** Stored text remains authoritative until the user starts editing. */
export function useTextDraft(source: string) {
  const [draft, setDraft] = useState<string | null>(null);

  return {
    value: draft ?? source,
    setValue: setDraft,
    reset: () => setDraft(null),
    save: async (value: string, write: (value: string) => Promise<void>) => {
      // Focusing and blurring untouched text must never write it back to sync.
      if (draft === null) return;
      if (value !== source) await write(value);
      // A response to an older edit must not discard text typed during save.
      setDraft((current) => current === draft ? null : current);
    },
  };
}
