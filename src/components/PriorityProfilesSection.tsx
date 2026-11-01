import { useEffect, useState } from "preact/hooks";
import { useStore } from "../store";
import { api } from "../lib/api";
import {
  hasOverrides,
  inputOf,
  isCustomized,
  PRIORITY_VALUES,
  profileFor,
  type PriorityProfile,
  type PriorityProfileInput,
} from "../lib/priority";
import {
  customKeysFor,
  MAX_CUSTOM_BYTES,
  parseSoundSettings,
  playSound,
  SOUND_KEYS,
  type SoundId,
} from "../lib/sound";
import { PALETTE } from "./LabelForm";
import { FlagIcon } from "./Icons";

/**
 * Settings → Priorities. The four priorities are fixed, so this renames,
 * recolors and re-sounds them rather than adding or removing any.
 *
 * Every reminder control carries a "Default" option, which stores a null and
 * means "follow the global settings in Notifications". That keeps the common
 * case configured in one place and leaves an untouched priority behaving
 * exactly as it did before profiles existed.
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
          Name and color each priority so it reads the way you think about it,
          and give the ones that matter their own reminder. Anything left on{" "}
          <em class="not-italic text-faint">Default</em> follows Notifications
          below. Quick-add still writes them as <code>p1</code>–<code>p4</code>.
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
          const changed = isCustomized(profile) || hasOverrides(profile);
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
                  <p class="mt-0.5 truncate text-xs text-muted">
                    {summarize(profile)}
                  </p>
                </div>
                {changed && (
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

/** The one-line description under each priority's name. */
function summarize(profile: PriorityProfile): string {
  const parts: string[] = [`P${profile.priority}`];
  if (profile.priority === 4 && !isCustomized(profile)) {
    parts.push("no priority, hidden on task rows");
  }
  if (profile.sound) {
    parts.push(
      profile.sound === "none"
        ? "silent"
        : SOUND_LABELS[profile.sound].toLowerCase(),
    );
  }
  if (profile.repeatMinutes !== null) {
    parts.push(
      profile.repeatMinutes === 0
        ? "fires once"
        : `repeats every ${profile.repeatMinutes} min`,
    );
  }
  if (profile.notificationStyle) {
    parts.push(
      profile.notificationStyle === "native"
        ? "system notification"
        : "in-app popup",
    );
  }
  return parts.join(" · ");
}

const SOUND_LABELS: Record<SoundId, string> = {
  none: "Silent",
  chime: "Chime",
  ping: "Ping",
  bell: "Bell",
  custom: "Custom",
};

/** `null` is always first, and always means "follow the global setting". */
const SOUND_CHOICES: { value: SoundId | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: "none", label: "Silent" },
  { value: "chime", label: "Chime" },
  { value: "ping", label: "Ping" },
  { value: "bell", label: "Bell" },
  { value: "custom", label: "Custom…" },
];

const STYLE_CHOICES: { value: "custom" | "native" | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: "custom", label: "In-app popup" },
  { value: "native", label: "System" },
];

const REPEAT_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: 0, label: "Don't repeat" },
  { value: 2, label: "Every 2 min" },
  { value: 5, label: "Every 5 min" },
  { value: 10, label: "Every 10 min" },
];

const RAMP_CHOICES: { value: boolean | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: true, label: "Get louder" },
  { value: false, label: "Stay level" },
];

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
  const [draft, setDraft] = useState<PriorityProfileInput>(() =>
    inputOf(profile),
  );
  const [customName, setCustomName] = useState<string | null>(null);
  const [soundError, setSoundError] = useState("");
  const keys = customKeysFor(profile.priority);

  // The stored file name, if this priority already has a sound of its own.
  useEffect(() => {
    api
      .getSetting(keys.name)
      .then(setCustomName)
      .catch(() => {});
  }, [keys.name]);

  const patch = (change: Partial<PriorityProfileInput>) =>
    setDraft((current) => ({ ...current, ...change }));

  const colorValid = /^#[0-9a-fA-F]{6}$/.test(draft.color);
  const trimmed = draft.name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 40 && colorValid;

  /**
   * Kept as bytes under this priority's own key rather than a path, so the
   * sound survives the file moving — and device-local, so a megabyte of audio
   * never rides along in a sync payload.
   */
  const pickCustomSound = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_CUSTOM_BYTES) {
        setSoundError(
          `That file is ${Math.round(file.size / 1024)} KB — the limit is ${MAX_CUSTOM_BYTES / 1024} KB.`,
        );
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const data = btoa(binary);
        await Promise.all([
          api.setSetting(keys.data, data),
          api.setSetting(keys.name, file.name),
        ]);
        setCustomName(file.name);
        setSoundError("");
        patch({ sound: "custom" });
        void preview("custom", data);
      } catch {
        setSoundError("That file couldn't be read.");
      }
    };
    input.click();
  };

  /** A preview that stays silent has to say why, or it reads as unimplemented. */
  const preview = async (sound: SoundId, data?: string | null) => {
    if (sound === "none") return;
    try {
      setSoundError("");
      const customData =
        data ?? (sound === "custom" ? await api.getSetting(keys.data) : null);
      // Without an override, a preview plays at whatever the global volume is
      // — parsed rather than `Number()`d, since an unset one is an empty
      // string and `Number("")` is a perfectly silent 0.
      const volume =
        draft.volume ??
        parseSoundSettings({
          volume: await api.getSetting(SOUND_KEYS.volume).catch(() => null),
        }).volume;
      // The ramp belongs to repeats, so a preview plays at the set volume.
      await playSound({ sound, volume, ramp: false, customData });
    } catch (error) {
      setSoundError(
        error instanceof Error ? error.message : "That sound couldn't be played.",
      );
    }
  };

  const chooseSound = (sound: SoundId | null) => {
    setSoundError("");
    // Picking "Custom…" with nothing loaded for this priority means "go find
    // one"; its bytes live under this priority's own key.
    if (sound === "custom" && !customName) return pickCustomSound();
    patch({ sound });
    if (sound) void preview(sound);
  };

  return (
    <form
      class="animate-fade-rise border-t border-border px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSave({ ...draft, name: trimmed });
      }}
    >
      <label class="block text-xs font-medium text-muted">
        Name
        <input
          autoFocus
          value={draft.name}
          maxLength={40}
          disabled={busy}
          onInput={(event) => patch({ name: event.currentTarget.value })}
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
            aria-pressed={draft.color.toLowerCase() === preset}
            onClick={() => patch({ color: preset })}
            style={{ background: preset }}
            class={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
              draft.color.toLowerCase() === preset
                ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-surface)"
                : ""
            }`}
          />
        ))}
      </div>
      <input
        value={draft.color}
        disabled={busy}
        onInput={(event) => patch({ color: event.currentTarget.value })}
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

      <Chips
        label="Reminder sound"
        choices={SOUND_CHOICES.map((choice) =>
          choice.value === "custom" && customName
            ? { ...choice, label: customName.replace(/\.[^.]+$/, "") }
            : choice,
        )}
        value={draft.sound}
        onSelect={chooseSound}
        disabled={busy}
      />
      {draft.sound === "custom" && (
        <button
          type="button"
          onClick={pickCustomSound}
          class="mt-1.5 text-xs text-(--color-accent) hover:underline"
        >
          Choose a different file…
        </button>
      )}
      {soundError && (
        <p class="mt-1.5 text-xs text-(--color-danger)">{soundError}</p>
      )}
      {draft.sound === "custom" && (
        <p class="mt-1.5 text-xs text-faint">
          The audio stays on this device. Other devices sharing your account
          fall back to the sound in Notifications.
        </p>
      )}

      {draft.sound !== "none" && (
        <>
          <div class="mt-3 flex items-center justify-between">
            <p class="text-xs font-medium text-muted">Volume</p>
            {draft.volume !== null && (
              <button
                type="button"
                onClick={() => patch({ volume: null })}
                class="text-xs text-muted hover:text-text"
              >
                Use default
              </button>
            )}
          </div>
          {draft.volume === null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ volume: 70 })}
              class="mt-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              Set a volume for this priority
            </button>
          ) : (
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={draft.volume}
              disabled={busy}
              onInput={(event) =>
                patch({ volume: Number(event.currentTarget.value) })
              }
              class="mt-1.5 w-full accent-(--color-accent)"
              aria-label="Reminder volume for this priority"
            />
          )}

          <Chips
            label="When a reminder repeats"
            choices={RAMP_CHOICES}
            value={draft.ramp}
            onSelect={(ramp) => patch({ ramp })}
            disabled={busy}
          />
        </>
      )}

      <Chips
        label="Notification style"
        choices={STYLE_CHOICES}
        value={draft.notificationStyle}
        onSelect={(notificationStyle) => patch({ notificationStyle })}
        disabled={busy}
      />

      <Chips
        label="Repeat an unanswered reminder"
        choices={REPEAT_CHOICES}
        value={draft.repeatMinutes}
        onSelect={(repeatMinutes) => patch({ repeatMinutes })}
        disabled={busy}
      />

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

/** A labelled row of single-choice chips, where one of them is "Default". */
function Chips<T>({
  label,
  choices,
  value,
  onSelect,
  disabled,
}: {
  label: string;
  choices: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <p class="mt-3 mb-2 text-xs font-medium text-muted">{label}</p>
      <div class="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = choice.value === value;
          return (
            <button
              key={String(choice.value)}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onSelect(choice.value)}
              class={`max-w-40 truncate rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "border-(--color-accent) bg-accent-soft text-text"
                  : "border-border text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
