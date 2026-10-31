import http from 'node:http';
import net from 'node:net';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { binding, resource } from '../tls-admission/resources.ts';
import { digest, must } from '../tls-admission/contract.ts';
import { readJson } from '../multitarget-plan/json.ts';
import { material } from '../tls-admission/material.ts';

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
  // Independent fixed reads share one round trip; none is a cached sample.
  const [domains, rawNetwork, volumes] = await Promise.all([
    Promise.all(
      expected.domains.map(async (d) =>
        resource(await get(`/containers/${d.id}/json`), expected.project, d.slot, expected.variant),
      ),
    ),
    get('/networks/' + expected.domains[0]!.network),
    Promise.all(expected.domains.flatMap((d) => d.mounts.map((m) => get('/volumes/' + m.name)))),
  ]);
  must(digest(domains) === digest(expected.domains));
  const network = rawNetwork as {
    Internal: boolean;
    Labels: Record<string, string>;
    Containers: Record<string, unknown>;
  };
  must(
    network.Internal === true &&
      network.Labels?.['com.docker.compose.project'] === expected.project,
  );
  const ids = Object.keys(network.Containers);
  must(ids.length <= 5);
  await Promise.all(
    ids
      .filter((id) => !domains.some((d) => d.id === id))
      .map(async (id) => {
        must(/^[a-f0-9]{64}$/.test(id));
        const peer = (await get('/containers/' + id + '/json')) as {
          Config: { Labels: Record<string, string> };
        };
        must(
          peer.Config?.Labels?.['com.docker.compose.project'] === expected.project &&
            ['observer', 'inspector', 'fault-controller'].includes(
              peer.Config.Labels['com.docker.compose.service'] ?? '',
            ),
        );
      }),
  );
  const mounts = expected.domains.flatMap((d) => d.mounts);
  volumes.forEach((raw, i) => {
    const v = raw as { Name: string; Driver: string; Labels: Record<string, string> };
    must(
      v.Name === mounts[i]!.name &&
        v.Driver === 'local' &&
        v.Labels?.['com.docker.compose.project'] === expected.project,
    );
  });
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
      'MC_RESOURCE_EVIDENCE ' +
        JSON.stringify({ requests, fixedReadOnlyDockerGets: gets, mutationCalls: 0 }),
    );
    process.exit(0);
  });
});
