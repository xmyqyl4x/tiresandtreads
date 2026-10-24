// Pure validation/expansion: callers persist locally, and never log the returned credentials.
export function addRoleCredentials(text, required, additions, generate) {
  const entries = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split('='));
  const present = new Set(entries.map(([key]) => key));
  if (
    present.size !== entries.length ||
    entries.some(
      ([key, value, extra]) =>
        !required.includes(key) || !/^[a-f0-9]{64}$/.test(value ?? '') || extra !== undefined,
    )
  )
    throw new Error('Invalid local database credential file');
  const missing = required.filter((key) => !present.has(key));
  if (missing.some((key) => !additions.includes(key)))
    throw new Error('Missing existing database credentials');
  if (!missing.length) return text;
  return (
    text.trimEnd() +
    '\n' +
    missing
      .map((key) => {
        const value = generate();
        if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid generated role credential');
        return `${key}=${value}`;
      })
      .join('\n') +
    '\n'
  );
}
