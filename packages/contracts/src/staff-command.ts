// A later refusal never resolves an earlier unknown outcome. Clients retain the original key/input.
export function staffCommandFailure(error: unknown, previouslyUncertain = false) {
  const e =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown; retryable?: unknown })
      : null;
  const code = typeof e?.code === 'string' ? e.code : 'unavailable';
  const uncertain =
    !e || e.retryable === true || ['unavailable', 'commit_unknown', 'timeout'].includes(code);
  return { code, uncertain, preserveCommand: previouslyUncertain || uncertain };
}
