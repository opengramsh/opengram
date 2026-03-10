let audioCtx: AudioContext | null = null;

const DEBOUNCE_MS = 2_000;
const lastPlayedAt = new Map<string, number>();

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playNotificationSound(chatId?: string): void {
  try {
    if (chatId) {
      const now = Date.now();
      const last = lastPlayedAt.get(chatId);
      if (last && now - last < DEBOUNCE_MS) {
        return;
      }
      lastPlayedAt.set(chatId, now);
    }

    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    // First tone
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Second tone (higher)
    const gain2 = ctx.createGain();
    gain2.connect(ctx.destination);
    gain2.gain.setValueAtTime(0.12, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1); // A5
    osc2.connect(gain2);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.25);
  } catch {
    // Sound is non-critical — swallow all errors
  }
}
