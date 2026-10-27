export interface LocalWorkflowRun {
  readonly id: string;
  readonly status: string;
  readonly function: { readonly slug: string };
  readonly cronSchedule: string | null;
}
export async function localWorkflowQuery(endpoint: string, query: string) {
  if (endpoint !== 'http://inngest:8288' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
    throw Error('Invalid local workflow endpoint');
  const r = await fetch(endpoint + '/v0/gql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await r.json()) as {
    errors?: unknown;
    data?: { runs?: { edges: { node: LocalWorkflowRun }[] }; run?: LocalWorkflowRun };
  };
  if (!r.ok || body.errors || !body.data) throw Error('Local workflow history unavailable');
  return body.data;
}
export async function completedMaintenance(endpoint: string, since: number) {
  const query = `{runs(first:10,orderBy:[],filter:{from:${JSON.stringify(new Date(since).toISOString())}}){edges{node{id status function{slug} cronSchedule}}}}`;
  const data = await localWorkflowQuery(endpoint, query);
  return data.runs?.edges
    .map((e) => e.node)
    .find(
      (r) =>
        r.status === 'COMPLETED' &&
        r.function.slug.endsWith('-service-maintenance-v1') &&
        r.cronSchedule === '* * * * *',
    );
}
