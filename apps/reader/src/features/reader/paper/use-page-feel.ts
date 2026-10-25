import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * The feel of a page turn: a haptic tick as a turned page lets go, and an
 * optional rustle made from shaped noise. Both are off unless asked for.
 *
 * Haptics: Android Chrome has `navigator.vibrate`. iOS Safari has no
 * vibration API, but since iOS 18 toggling a native switch
 * (`<input type="checkbox" switch>`) plays the system's selection haptic,
 * including through a label's `click()`. Like other activation-gated
 * behaviour it works inside a user gesture, so the tick plays on release,
 * in the pointerup that commits the turn, not later when the page lands.
 * The Simulator has no Taptic Engine, so only a device can confirm it.
 *
 * Sound: Web Audio, no recording. A looped buffer of crackly noise runs
 * through a band-pass filter whose gain and pitch follow the page's speed;
 * a release adds a short swoosh and a landing a soft pat. Audio unlocks on
 * the first tap, as iOS requires, and follows the ring/silent switch.
 */

const SWITCH_SUPPORTED =
  typeof HTMLInputElement !== "undefined" &&
  "switch" in HTMLInputElement.prototype;

function hapticTick(): void {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
    return;
  }
  if (!SWITCH_SUPPORTED) return;
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  label.remove();
}

/** Two seconds of paper noise: soft hiss with sparse crackle. */
function paperNoise(context: AudioContext): AudioBuffer {
  const length = Math.round(context.sampleRate * 2);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let smoothed = 0;
  let crackle = 0;
  for (let index = 0; index < length; index++) {
    const white = Math.random() * 2 - 1;
    smoothed = smoothed * 0.6 + white * 0.4;
    if (Math.random() < 0.0016) crackle = 0.6 + Math.random() * 0.4;
    crackle *= 0.992;
    data[index] = smoothed * (0.35 + crackle);
  }
  // Fade the loop's ends together.
  const fade = Math.round(context.sampleRate * 0.02);
  for (let index = 0; index < fade; index++) {
    const t = index / fade;
    data[index]! *= t;
    data[length - 1 - index]! *= t;
  }
  return buffer;
}

class PaperSound {
  private readonly context: AudioContext;
  private readonly noise: AudioBuffer;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private lastOffset = 0;
  private lastTime = 0;

  constructor() {
    this.context = new AudioContext();
    this.noise = paperNoise(this.context);
    this.filter = this.context.createBiquadFilter();
    this.filter.type = "bandpass";
    this.filter.Q.value = 0.9;
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.filter.connect(this.gain).connect(this.context.destination);
  }

  unlock(): void {
    if (this.context.state !== "running") void this.context.resume();
  }

  start(): void {
    this.unlock();
    if (this.source) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.connect(this.filter);
    source.start();
    this.source = source;
    this.lastTime = 0;
  }

  /** Follows the page: louder and brighter as it moves faster. */
  drag(offset: number): void {
    if (!this.source) this.start();
    const now = this.context.currentTime;
    if (this.lastTime > 0) {
      const elapsed = Math.max(1 / 240, now - this.lastTime);
      const speed = Math.abs(offset - this.lastOffset) / elapsed;
      const level = Math.min(1, speed / 2200) ** 1.3;
      this.gain.gain.setTargetAtTime(level * 0.09, now, 0.03);
      this.filter.frequency.setTargetAtTime(
        1200 + Math.min(speed, 3200) * 1.1,
        now,
        0.05,
      );
    }
    this.lastOffset = offset;
    this.lastTime = now;
  }

  /** A short swoosh as the page is let go. */
  release(velocity: number): void {
    const now = this.context.currentTime;
    const level = Math.min(1, Math.abs(velocity) / 2400);
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0.04 + level * 0.08, now, 0.015);
    this.gain.gain.setTargetAtTime(0, now + 0.09, 0.12);
  }

  /** A soft pat as the page lands, then silence. */
  land(): void {
    const now = this.context.currentTime;
    const pat = this.context.createBufferSource();
    pat.buffer = this.noise;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 700;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.06, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    pat.connect(lowpass).connect(envelope).connect(this.context.destination);
    pat.start(now, Math.random());
    pat.stop(now + 0.08);
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0, now, 0.04);
    const source = this.source;
    this.source = null;
    source?.stop(now + 0.3);
  }

  close(): void {
    this.source?.stop();
    void this.context.close();
  }
}

export interface PageFeel {
  start: () => void;
  drag: (offset: number) => void;
  release: (targetOffset: number, velocity: number) => void;
  settled: () => void;
}

export function usePageFeel(options: {
  haptics: boolean;
  sound: boolean;
}): PageFeel {
  const { sound } = options;
  const soundRef = useRef<PaperSound | null>(null);
  const settingsRef = useRef(options);
  settingsRef.current = options;

  useEffect(() => {
    if (!sound) return;
    // iOS lets audio start only inside a tap; the first one unlocks it.
    const unlock = () => {
      if (!soundRef.current) soundRef.current = new PaperSound();
      soundRef.current.unlock();
    };
    window.addEventListener("pointerup", unlock, true);
    return () => {
      window.removeEventListener("pointerup", unlock, true);
      soundRef.current?.close();
      soundRef.current = null;
    };
  }, [sound]);

  const start = useCallback(() => soundRef.current?.start(), []);
  const drag = useCallback((offset: number) => {
    if (settingsRef.current.sound) soundRef.current?.drag(offset);
  }, []);
  const release = useCallback((targetOffset: number, velocity: number) => {
    if (targetOffset !== 0 && settingsRef.current.haptics) hapticTick();
    soundRef.current?.release(velocity);
  }, []);
  const settled = useCallback(() => soundRef.current?.land(), []);

  return useMemo(
    () => ({ start, drag, release, settled }),
    [drag, release, settled, start],
  );
}
