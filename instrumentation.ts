export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkSettings } = await import('./lib/settings.mjs');
    try {
      checkSettings();
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Invalid production settings');
      process.exit(1);
    }
  }
}
