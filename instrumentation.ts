import { ensureStreamingTimeoutSweeperStarted } from '@/src/services/messages-service';

export async function register() {
  ensureStreamingTimeoutSweeperStarted();
}
