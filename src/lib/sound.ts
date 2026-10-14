/**
 * Reminder sounds.
 *
 * Built-in tones are synthesized rather than shipped as audio files: nothing to
 * license and nothing to go missing from the bundle. A custom sound is stored
 * as base64 rather than as a path, so it survives the file being moved.
 */

export type SoundId = "none" | "chime" | "ping" | "bell" | "custom";

export const SOUNDS: { value: SoundId; label: string }[] = [
  { value: "none", label: "Silent" },
  { value: "chime", label: "Chime" },
  { value: "ping", label: "Ping" },
  { value: "bell", label: "Bell" },
  { value: "custom", label: "Custom…" },
];

/** Custom sounds live in the database, so they have to stay small. */
export const MAX_CUSTOM_BYTES = 1024 * 1024;

/** Shared by the player and the settings screen. */
export const SOUND_KEYS = {
  sound: "reminder_sound",
  volume: "reminder_volume",
  ramp: "reminder_volume_ramp",
  data: "reminder_sound_data",
  name: "reminder_sound_name",
} as const;

export const DEFAULT_VOLUME = 70;

export interface SoundSettings {
  sound: SoundId;
  /** 0–100. */
  volume: number;
  /** Start quiet and climb over successive unanswered reminders. */
  ramp: boolean;
  customData?: string | null;
}

/** Anything missing or malformed falls back rather than silencing reminders. */
export function parseSoundSettings(stored: {
  sound?: string | null;
  volume?: string | null;
  ramp?: string | null;
  data?: string | null;
}): SoundSettings {
  const sound = SOUNDS.find((option) => option.value === stored.sound)?.value;
  // `Number(null)` and `Number("")` are both a perfectly finite 0, so an unset
  // volume has to be rejected before the numeric check below — otherwise every
  // profile that never touched the slider starts silent.
  const raw = stored.volume?.trim();
  const volume = raw ? Number(raw) : NaN;
  return {
    sound: sound ?? "chime",
    volume: Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_VOLUME,
    ramp: stored.ramp === "true",
    customData: stored.data ?? null,
  };
}

/** How many repeats it takes to climb from `RAMP_FLOOR` to the set volume. */
const RAMP_STEPS = 4;
const RAMP_FLOOR = 0.25;

/**
 * Gain for a given round, counting from 1. Without the ramp, every round plays
 * at the set volume.
 */
export function gainForRound(
  volume: number,
  ramp: boolean,
  round: number,
): number {
  const target = Math.min(100, Math.max(0, volume)) / 100;
  if (!ramp) return target;
  const step = Math.min(1, Math.max(0, (round - 1) / RAMP_STEPS));
  return target * (RAMP_FLOOR + (1 - RAMP_FLOOR) * step);
}

/** Partials per tone: [frequency in Hz, start offset in seconds]. */
const TONES: Record<Exclude<SoundId, "none" | "custom">, [number, number][]> = {
  chime: [
    [880, 0],
    [1108.73, 0.12],
    [1318.51, 0.24],
  ],
  ping: [[1568, 0]],
  bell: [
    [523.25, 0],
    [1046.5, 0],
    [1567.98, 0.02],
  ],
};

let context: AudioContext | null = null;

/**
 * Browsers start a context suspended until the page has seen a user gesture,
 * and may suspend it again when the window hides. A reminder fires on a timer,
 * which is never a gesture, so resume on every play.
 *
 * Failures throw rather than returning null: every one of them is silence, and
 * silence is the one outcome the caller can't tell apart from success.
 */
async function audio(): Promise<AudioContext> {
  if (typeof AudioContext === "undefined") {
    throw new Error("This build's webview has no Web Audio support.");
  }
  if (!context) context = new AudioContext();
  if (context.state !== "running") {
    await context.resume();
  }
  if (context.state !== "running") {
    // On Linux this is usually WebKitGTK without the GStreamer plugins it
    // needs; the context exists but never starts.
    throw new Error("The system blocked audio playback.");
  }
  return context;
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

let customBuffer: { data: string; buffer: AudioBuffer } | null = null;

async function playCustom(
  ctx: AudioContext,
  data: string,
  gain: number,
): Promise<void> {
  // Decoding is the expensive part; keep it for the next reminder.
  if (customBuffer?.data !== data) {
    const buffer = await ctx.decodeAudioData(decodeBase64(data));
    customBuffer = { data, buffer };
  }
  const source = ctx.createBufferSource();
  source.buffer = customBuffer.buffer;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  source.connect(amp).connect(ctx.destination);
  source.start();
}

function playTone(
  ctx: AudioContext,
  partials: [number, number][],
  gain: number,
): void {
  for (const [frequency, offset] of partials) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;

    // Struck-then-decaying. The short attack keeps it from clicking.
    const start = ctx.currentTime + offset;
    const end = start + 0.9;
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(gain, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(end);
  }
}

/**
 * Play once, reporting why it failed. Used by the settings preview, where
 * silence with no explanation is indistinguishable from an unbuilt feature.
 */
export async function playSound(
  settings: SoundSettings,
  round = 1,
): Promise<void> {
  if (settings.sound === "none") return;
  const gain = gainForRound(settings.volume, settings.ramp, round);
  if (gain <= 0) return;

  const ctx = await audio();

  if (settings.sound === "custom") {
    if (!settings.customData) throw new Error("No custom sound is loaded.");
    await playCustom(ctx, settings.customData, gain);
    return;
  }
  playTone(ctx, TONES[settings.sound], gain);
}

/**
 * Silent settings, a missing audio context and a corrupt custom sound all end
 * the same way: quietly. A sound must never break the reminder it belongs to.
 */
export async function playReminderSound(
  settings: SoundSettings,
  round = 1,
): Promise<void> {
  try {
    await playSound(settings, round);
  } catch {
    // Nothing to report: the notification itself has already been shown.
  }
}
