// Missing/expired selected images preserve the assessment; authority errors still disconnect.
export async function recoverMissingPhoto<T>(
  work: () => Promise<T>,
): Promise<{ missing: true } | { missing: false; value: T }> {
  try {
    return { missing: false, value: await work() };
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'not_found')
      return { missing: true };
    throw e;
  }
}
