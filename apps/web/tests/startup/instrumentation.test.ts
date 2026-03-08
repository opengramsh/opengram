import { afterEach, describe, expect, it } from 'vitest';

import { startBackgroundJobs } from '@/src/server';
import {
  isStreamingTimeoutSweeperRunningForTests,
  resetStreamingTimeoutSweeperForTests,
} from '@/src/services/messages-service';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  resetStreamingTimeoutSweeperForTests();
});

describe('background job startup', () => {
  it('starts the streaming timeout sweeper via startBackgroundJobs', () => {
    resetStreamingTimeoutSweeperForTests();
    process.env.NODE_ENV = 'development';

    startBackgroundJobs();

    expect(isStreamingTimeoutSweeperRunningForTests()).toBe(true);
  });
});
