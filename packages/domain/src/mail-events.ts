export function mailActivity(type: string, agent: unknown) {
  if (typeof agent !== 'string' || agent.length > 1024 || !agent) return 'unknown' as const;
  if (/bot|spider|crawl|scanner|proofpoint|safelinks|barracuda|mimecast|headless/i.test(agent))
    return 'machine' as const;
  return type === 'clicked' && /Mozilla\//.test(agent)
    ? ('suspected_human' as const)
    : ('unknown' as const);
}
export function fixedEmailDestination(
  origin: string,
  purpose: 'education' | 'feedback',
  path: string,
) {
  if (
    !/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(origin) ||
    !(purpose === 'education'
      ? /^\/learn\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
      : purpose === 'feedback' && path === '/email/feedback')
  )
    throw Error('Invalid email destination');
  return origin + path;
}
