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
  const volume = Number(stored.volume);
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
 */
async function audio(): Promise<AudioContext | null> {
  if (typeof AudioContext === "undefined") return null;
  if (!context) context = new AudioContext();
  if (context.state === "suspended") {
    await context.resume().catch(() => {});
  }
  return context.state === "running" ? context : null;
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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
 * Silent settings, a missing audio context and a corrupt custom sound all end
 * the same way: quietly. A sound must never break the reminder it belongs to.
 */
export async function playReminderSound(
  settings: SoundSettings,
  round = 1,
): Promise<void> {
  if (settings.sound === "none") return;
  const gain = gainForRound(settings.volume, settings.ramp, round);
  if (gain <= 0) return;

  const ctx = await audio();
  if (!ctx) return;

  try {
    if (settings.sound === "custom") {
      if (settings.customData) await playCustom(ctx, settings.customData, gain);
      return;
    }
    playTone(ctx, TONES[settings.sound], gain);
  } catch {
    // Nothing to report: the notification itself has already been shown.
  }
}
