import http from 'node:http';
import net from 'node:net';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { binding, resource } from './resources.ts';
import { digest, must } from './contract.ts';
import { readJson } from '../multitarget-plan/json.ts';
import { material } from './material.ts';

// Trusted test-only Docker custodian. The socket gives daemon authority despite
// its read-only mount: this code makes fixed GET requests only, not a sandbox.
const expected = binding(JSON.parse(readFileSync('/binding.json', 'utf8')));
let requests = 0,
  gets = 0;
function get(path: string): Promise<unknown> {
  must(
    /^\/(containers\/[a-f0-9]{64}\/json|networks\/[a-f0-9]{64}|volumes\/tt-test-[a-f0-9]{16}_[a-z-]+)$/.test(
      path,
    ),
  );
  gets++;
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', method: 'GET', path }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (Buffer.byteLength(raw) > 1048576) req.destroy(Error('bounded'));
      });
      res.on('end', () => {
        try {
          must(res.statusCode === 200);
          resolve(JSON.parse(raw));
        } catch {
          reject(Error('unavailable'));
        }
      });
      res.on('error', () => reject(Error('unavailable')));
    });
    req.setTimeout(500, () => req.destroy(Error('unavailable')));
    req.on('error', () => reject(Error('unavailable')));
    req.end();
  });
}
async function current() {
  must(material() === expected.material);
  const domains = await Promise.all(
    expected.domains.map(async (d) =>
      resource(await get(`/containers/${d.id}/json`), expected.project, d.slot, expected.variant),
    ),
  );
  must(digest(domains) === digest(expected.domains));
  const network = (await get('/networks/' + domains[0]!.network)) as {
    Internal: boolean;
    Labels: Record<string, string>;
    Containers: Record<string, unknown>;
  };
  must(
    network.Internal === true &&
      network.Labels?.['com.docker.compose.project'] === expected.project,
  );
  for (const id of Object.keys(network.Containers)) {
    must(/^[a-f0-9]{64}$/.test(id));
    if (domains.some((d) => d.id === id)) continue;
    const c = (await get('/containers/' + id + '/json')) as {
      Config: { Labels: Record<string, string> };
    };
    must(
      c.Config?.Labels?.['com.docker.compose.project'] === expected.project &&
        c.Config.Labels['com.docker.compose.service'] === 'observer',
    );
  }
  await Promise.all(
    domains.flatMap((d) =>
      d.mounts.map(async (m) => {
        const v = (await get('/volumes/' + m.name)) as {
          Name: string;
          Driver: string;
          Labels: Record<string, string>;
        };
        must(
          v.Name === m.name &&
            v.Driver === 'local' &&
            v.Labels?.['com.docker.compose.project'] === expected.project,
        );
      }),
    ),
  );
}
if (existsSync('/control/admission.sock')) unlinkSync('/control/admission.sock');
let active = 0;
const server = net.createServer((socket) => {
  let input = '',
    handled = false;
  socket.setTimeout(1000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    input += chunk.toString('utf8');
    if (Buffer.byteLength(input) > 256) {
      socket.destroy();
      return;
    }
    if (!input.endsWith('\n') || handled) return;
    handled = true;
    requests++;
    void (async () => {
      let nonce = '0'.repeat(16),
        ok = false;
      try {
        const r = readJson(input.trim(), 256) as Record<string, unknown>;
        must(
          r &&
            Object.keys(r).length === 2 &&
            r.version === 1 &&
            typeof r.nonce === 'string' &&
            /^[a-f0-9]{16}$/.test(r.nonce),
        );
        nonce = r.nonce;
        must(active < 2);
        active++;
        try {
          await current();
          ok = true;
        } finally {
          active--;
        }
      } catch {
        /* A stale map is never substituted for unavailable inspection. */
      }
      socket.end(
        JSON.stringify({
          version: 1,
          project: expected.project,
          fixtureGeneration: expected.fixtureGeneration,
          nonce,
          current: ok,
          binding: digest(expected),
        }) + '\n',
      );
    })();
  });
});
server.listen('/control/admission.sock', () =>
  console.log('Owned read-only resource supervisor ready'),
);
process.once('SIGTERM', () => {
  server.close(() => {
    console.log(
      'TLS_SUPERVISOR_EVIDENCE ' +
        JSON.stringify({ requests, fixedReadOnlyDockerGets: gets, mutationCalls: 0 }),
    );
    process.exit(0);
  });
});
