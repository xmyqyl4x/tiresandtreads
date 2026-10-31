import versions from '../../../infra/local/versions.json' with { type: 'json' };
import { must } from './contract.ts';
export type Variant = 'valid' | 'expired' | 'future' | 'plaintext';
type Inspect = {
  Id: string;
  Name: string;
  State: {
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    StartedAt: string;
    Health: { Status: string };
  };
  Config: { Image: string; Cmd: string[]; Labels: Record<string, string> };
  HostConfig: { PortBindings: Record<string, unknown> | null };
  Mounts: { Type: string; Name: string; Destination: string; RW: boolean }[];
  NetworkSettings: {
    Ports: Record<string, unknown>;
    Networks: Record<string, { NetworkID: string; IPAddress: string; Aliases: string[] }>;
  };
};
export function resource(raw: unknown, project: string, slot: 0 | 1, variant: Variant) {
  const c = raw as Inspect,
    service = slot === 0 ? 'postgres' : 'recovery-postgres';
  must(
    c &&
      /^[a-f0-9]{64}$/.test(c.Id) &&
      c.Config?.Image === versions.postgresImage &&
      c.Config.Labels?.['com.docker.compose.project'] === project &&
      c.Config.Labels['com.docker.compose.service'] === service,
  );
  must(
    c.State?.Running === true &&
      c.State.Paused === false &&
      c.State.Restarting === false &&
      c.State.Health?.Status === 'healthy' &&
      typeof c.State.StartedAt === 'string' &&
      c.State.StartedAt.length <= 64 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(c.State.StartedAt) &&
      Date.parse(c.State.StartedAt) > 0,
  );
  const ssl = slot === 0 && variant === 'plaintext' ? 'off' : 'on',
    leaf = slot === 0 && ['expired', 'future'].includes(variant) ? variant : 'valid';
  must(
    JSON.stringify(c.Config.Cmd) ===
      JSON.stringify([
        'postgres',
        '-c',
        'ssl=' + ssl,
        '-c',
        `ssl_cert_file=/tls/server.${leaf}.crt`,
        '-c',
        'ssl_key_file=/tls/server.key',
      ]),
  );
  must(
    !Object.keys(c.HostConfig?.PortBindings ?? {}).length &&
      Object.values(c.NetworkSettings.Ports).every((x) => x === null),
  );
  must(Array.isArray(c.Mounts) && c.Mounts.length === 2);
  const mounts = c.Mounts.map((m) => {
    must(
      m.Type === 'volume' &&
        typeof m.Name === 'string' &&
        m.Name.startsWith(project + '_') &&
        ((m.Destination === '/var/lib/postgresql' && m.RW === true) ||
          (m.Destination === '/tls' && m.RW === false)),
    );
    return { name: m.Name, destination: m.Destination, rw: m.RW };
  }).sort((a, b) => a.destination.localeCompare(b.destination));
  must(new Set(mounts.map((m) => m.destination)).size === 2);
  const networks = Object.entries(c.NetworkSettings.Networks);
  must(networks.length === 1 && networks[0]![0] === project + '_local');
  const n = networks[0]![1],
    host = slot === 0 ? 'postgres.preflight.test' : 'recovery-postgres.preflight.test',
    mismatch =
      slot === 0 ? 'postgres.mismatch.preflight.test' : 'recovery-postgres.mismatch.preflight.test';
  must(
    /^[a-f0-9]{64}$/.test(n.NetworkID) &&
      typeof n.IPAddress === 'string' &&
      /^\d+\.\d+\.\d+\.\d+$/.test(n.IPAddress) &&
      Array.isArray(n.Aliases),
  );
  const allowed = [service, c.Name.replace(/^\//, ''), host, mismatch];
  must(
    n.Aliases.includes(host) &&
      n.Aliases.includes(mismatch) &&
      n.Aliases.every((x) => allowed.includes(x)),
  );
  return {
    slot,
    id: c.Id,
    startedAt: c.State.StartedAt,
    mounts,
    network: n.NetworkID,
    address: n.IPAddress,
    aliases: [...n.Aliases].sort(),
    command: [...c.Config.Cmd],
  };
}
export type Binding = {
  version: 1;
  project: string;
  fixtureGeneration: string;
  variant: Variant;
  material: string;
  domains: ReturnType<typeof resource>[];
};
export function binding(value: unknown): Binding {
  const b = value as Binding;
  must(
    b &&
      b.version === 1 &&
      /^tt-test-[a-f0-9]{16}$/.test(b.project) &&
      /^[a-f0-9]{32}$/.test(b.fixtureGeneration) &&
      /^[a-f0-9]{64}$/.test(b.material) &&
      ['valid', 'expired', 'future', 'plaintext'].includes(b.variant) &&
      Array.isArray(b.domains) &&
      b.domains.length === 2,
  );
  must(
    b.domains[0]?.slot === 0 &&
      b.domains[1]?.slot === 1 &&
      b.domains[0].id !== b.domains[1].id &&
      b.domains[0].address !== b.domains[1].address &&
      b.domains[0].network === b.domains[1].network,
  );
  must(b.domains[0].mounts.every((a) => b.domains[1]!.mounts.every((z) => a.name !== z.name)));
  return b;
}
