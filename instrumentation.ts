export async function register() {
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime === 'edge') {
    return;
  }

  const { registerNodeInstrumentation } = await import('@/instrumentation-node');
  registerNodeInstrumentation();
}
