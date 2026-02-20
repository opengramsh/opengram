import { startHooksSubscriber, startRetentionCleanupJob } from '@/src/services/hooks-service';
import { ensureStreamingTimeoutSweeperStarted } from '@/src/services/messages-service';

export function registerNodeInstrumentation() {
  ensureStreamingTimeoutSweeperStarted();
  startHooksSubscriber();
  startRetentionCleanupJob();
}
