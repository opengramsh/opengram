import { afterEach, describe, expect, it } from 'vitest';

import { register } from '@/instrumentation';
import {
  isStreamingTimeoutSweeperRunningForTests,
  resetStreamingTimeoutSweeperForTests,
} from '@/src/services/messages-service';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  resetStreamingTimeoutSweeperForTests();
});

describe('instrumentation startup', () => {
  it('starts the streaming timeout sweeper during app register', async () => {
    resetStreamingTimeoutSweeperForTests();
    process.env.NODE_ENV = 'development';

    await register();

    expect(isStreamingTimeoutSweeperRunningForTests()).toBe(true);
  });
});
