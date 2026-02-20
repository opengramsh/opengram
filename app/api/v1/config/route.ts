import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares } from '@/src/api/write-controls';
import { loadOpengramConfig } from '@/src/config/opengram-config';

export async function GET(request: Request) {
  try {
    applyReadMiddlewares(request);
    const config = loadOpengramConfig();

    return NextResponse.json({
      appName: config.appName,
      maxUploadBytes: config.maxUploadBytes,
      allowedMimeTypes: config.allowedMimeTypes,
      titleMaxChars: config.titleMaxChars,
      defaultCustomState: config.defaultCustomState,
      customStates: config.customStates,
      defaultModelIdForNewChats: config.defaultModelIdForNewChats,
      agents: config.agents,
      models: config.models,
      push: {
        enabled: config.push.enabled,
        vapidPublicKey: config.push.vapidPublicKey,
        subject: config.push.subject,
      },
      security: {
        instanceSecretEnabled: config.security.instanceSecretEnabled,
        readEndpointsRequireInstanceSecret: config.security.readEndpointsRequireInstanceSecret,
      },
      server: {
        publicBaseUrl: config.server.publicBaseUrl,
        port: config.server.port,
        streamTimeoutSeconds: config.server.streamTimeoutSeconds,
        idempotencyTtlSeconds: config.server.idempotencyTtlSeconds,
      },
      hooks: config.hooks.map((hook) => ({
        url: hook.url,
        events: hook.events,
        timeoutMs: hook.timeoutMs,
        maxRetries: hook.maxRetries,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
