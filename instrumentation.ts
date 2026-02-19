import { startHooksSubscriber, startRetentionCleanupJob } from '@/src/services/hooks-service';
import { ensureStreamingTimeoutSweeperStarted } from '@/src/services/messages-service';

export async function register() {
  ensureStreamingTimeoutSweeperStarted();
  startHooksSubscriber();
  startRetentionCleanupJob();
}
