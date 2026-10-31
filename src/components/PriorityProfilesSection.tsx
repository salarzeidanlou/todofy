import { useState } from "preact/hooks";
import { useStore } from "../store";
import {
  inputOf,
  isCustomized,
  PRIORITY_VALUES,
  profileFor,
  type PriorityProfile,
  type PriorityProfileInput,
} from "../lib/priority";
import { PALETTE } from "./LabelForm";
import { FlagIcon } from "./Icons";

/**
 * Settings → Priorities. The four priorities are fixed, so this renames and
 * recolors them rather than adding or removing any.
 */
export function PriorityProfilesSection() {
  const { priorityProfiles, updatePriorityProfile, resetPriorityProfile } =
    useStore();
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="mb-6">
      <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        Priorities
      </h3>
      <div class="overflow-hidden rounded-xl border border-border bg-surface">
        <p class="border-b border-border px-4 py-3 text-xs text-muted">
          Name and color each priority so it reads the way you think about it.
          Quick-add still writes them as <code>p1</code>–<code>p4</code>.
        </p>
        {error && (
          <p
            role="alert"
            class="border-b border-border px-4 py-2 text-xs text-(--color-danger)"
          >
            {error}
          </p>
        )}
        {PRIORITY_VALUES.map((priority) => {
          const profile = profileFor(priority, priorityProfiles);
          const open = editing === priority;
          return (
            <div key={priority} class="border-b border-border last:border-b-0">
              <div class="flex items-center gap-3 px-4 py-3">
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2"
                  style={{ color: profile.color }}
                >
                  <FlagIcon width={18} height={18} />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-text">
                    {profile.name}
                  </p>
                  <p class="mt-0.5 text-xs text-muted">
                    P{priority}
                    {priority === 4 && !isCustomized(profile)
                      ? " · no priority, hidden on task rows"
                      : ""}
                  </p>
                </div>
                {isCustomized(profile) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await resetPriorityProfile(priority);
                        setEditing(null);
                      })
                    }
                    class="shrink-0 text-xs text-muted hover:text-text disabled:opacity-50"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(open ? null : priority);
                    setError(null);
                  }}
                  aria-expanded={open}
                  class="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
                >
                  {open ? "Close" : "Edit"}
                </button>
              </div>
              {open && (
                <PriorityEditor
                  key={profile.updatedAt}
                  profile={profile}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(input) =>
                    run(async () => {
                      await updatePriorityProfile(priority, input);
                      setEditing(null);
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PriorityEditor({
  profile,
  busy,
  onCancel,
  onSave,
}: {
  profile: PriorityProfile;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: PriorityProfileInput) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(color);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 40 && colorValid;

  return (
    <form
      class="animate-fade-rise border-t border-border px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSave({ ...inputOf(profile), name: trimmed, color });
      }}
    >
      <label class="block text-xs font-medium text-muted">
        Name
        <input
          autoFocus
          value={name}
          maxLength={40}
          disabled={busy}
          onInput={(event) => setName(event.currentTarget.value)}
          class="mt-1.5 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-(--color-accent)"
        />
      </label>

      <p class="mt-3 mb-2 text-xs font-medium text-muted">Color</p>
      <div
        role="group"
        aria-label="Priority color presets"
        class="flex flex-wrap gap-1.5"
      >
        {PALETTE.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={busy}
            aria-label={`Use ${preset}`}
            aria-pressed={color.toLowerCase() === preset}
            onClick={() => setColor(preset)}
            style={{ background: preset }}
            class={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
              color.toLowerCase() === preset
                ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-surface)"
                : ""
            }`}
          />
        ))}
      </div>
      <input
        value={color}
        disabled={busy}
        onInput={(event) => setColor(event.currentTarget.value)}
        aria-invalid={!colorValid}
        aria-label="Priority color"
        placeholder="#6c7cff"
        class="mt-2 w-28 rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-(--color-accent)"
      />
      {!colorValid && (
        <p class="mt-1.5 text-xs text-(--color-danger)">
          Use a six-digit hex color, such as #6c7cff.
        </p>
      )}

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !valid}
          class="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
