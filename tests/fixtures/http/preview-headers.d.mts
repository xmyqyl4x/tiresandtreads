export function previewForwardHeaders(
  incoming: Readonly<Record<string, string | readonly string[] | undefined>>,
  authority: string,
  path: string,
  method: string,
): Record<string, string>;
