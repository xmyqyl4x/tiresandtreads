import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertFresh } from './ownership.mjs';

export function sentinel(primary, tooling) {
  if (!/^tt-test-[a-f0-9]{16}$/.test(primary) || !/^tt-test-[a-f0-9]{16}$/.test(tooling))
    throw Error('Fixed synthetic custody required');
  const project = 'tt-test-' + randomBytes(8).toString('hex'),
    token = randomBytes(16).toString('hex');
  assertFresh(project);
  const volume = project + '_preserve',
    name = project + '-sentinel',
    network = primary + '_local';
  const call = (args) => run('docker', args, { capture: true, timeout: 10000 });
  let id = '',
    before = null;
  const custodyFile = resolve('.local/' + primary + '-sentinel.json');
  const inspect = () => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Owned sentinel creation uncertain');
    const c = JSON.parse(call(['inspect', id]))[0];
    if (
      c.Id !== id ||
      !c.State.Running ||
      c.Config.Labels?.['com.docker.compose.project'] !== project ||
      c.Config.Labels?.['fixture.custody'] !== token ||
      c.Mounts.length !== 1 ||
      c.Mounts[0].Name !== volume
    )
      throw Error('Sentinel ownership unavailable');
    const v = JSON.parse(call(['volume', 'inspect', volume]))[0];
    if (
      v.Name !== volume ||
      v.Labels?.['fixture.custody'] !== token ||
      v.Labels?.['com.docker.compose.project'] !== project
    )
      throw Error('Sentinel volume ownership unavailable');
    const net = JSON.parse(call(['network', 'inspect', project + '_local']))[0];
    if (
      !net.Internal ||
      net.Labels?.['fixture.custody'] !== token ||
      !c.NetworkSettings.Networks[project + '_local']
    )
      throw Error('Sentinel network ownership unavailable');
    return c;
  };
  const witness = () => {
    inspect();
    const value = call([
      'exec',
      id,
      'node',
      '-e',
      "const f=require('fs');let n=0;const t=setInterval(()=>{if(f.existsSync('/sentinel/witness')){clearInterval(t);process.stdout.write(require('crypto').createHash('sha256').update(f.readFileSync('/sentinel/witness')).digest('hex'))}else if(++n>30)process.exit(1)},50)",
    ]);
    if (!/^[a-f0-9]{64}$/.test(value)) throw Error('Sentinel witness unavailable');
    return value;
  };
  let attached = false;
  return {
    create() {
      writeFileSync(
        custodyFile,
        JSON.stringify({
          scope: 'parent-owned-synthetic-sentinel',
          primary,
          project,
          token,
          volume,
          name,
          network: project + '_local',
          independentDurability: false,
          authenticated: false,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      call([
        'network',
        'create',
        '--internal',
        '--label',
        'com.docker.compose.project=' + project,
        '--label',
        'fixture.custody=' + token,
        project + '_local',
      ]);
      call([
        'volume',
        'create',
        '--label',
        'com.docker.compose.project=' + project,
        '--label',
        'fixture.custody=' + token,
        volume,
      ]);
      id = call([
        'run',
        '--detach',
        '--name',
        name,
        '--network',
        project + '_local',
        '--read-only',
        '--memory',
        '128m',
        '--cpus',
        '1',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--label',
        'com.docker.compose.project=' + project,
        '--label',
        'com.docker.compose.service=route-sentinel',
        '--label',
        'fixture.custody=' + token,
        '--env',
        'FIXTURE_WITNESS=' + token,
        '--mount',
        `type=volume,src=${volume},dst=/sentinel`,
        'tiresandtreads-tooling:' + tooling,
        'node',
        '-e',
        "require('fs').writeFileSync('/sentinel/witness',process.env.FIXTURE_WITNESS,{flag:'wx',mode:384});setInterval(()=>{},1000)",
      ]);
      if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Owned sentinel creation uncertain');
      before = witness();
    },
    attach() {
      inspect();
      call(['network', 'connect', '--alias', 'postgres.preflight.test', network, id]);
      attached = true;
      const c = inspect();
      if (!c.NetworkSettings.Networks[network]?.Aliases?.includes('postgres.preflight.test'))
        throw Error('Actual duplicate alias not observed');
      console.log(
        'RR_ALIAS_EVIDENCE ' +
          JSON.stringify({
            sameAliasOnSeparateOwnedActor: true,
            separateProject: true,
            sqlDispatches: 0,
            providerDispatches: 0,
          }),
      );
    },
    detach() {
      if (attached) {
        inspect();
        call(['network', 'disconnect', network, id]);
        attached = false;
        if (inspect().NetworkSettings.Networks[network])
          throw Error('Owned alias detach unobserved');
      }
    },
    preserved() {
      if (attached || witness() !== before) throw Error('Separate sentinel not preserved');
      console.log(
        'RR_SENTINEL_EVIDENCE ' +
          JSON.stringify({
            primaryTeardownComplete: true,
            separateActorRunning: true,
            separateVolumePreserved: true,
            separateNetworkPreserved: true,
            witnessUnchanged: true,
            primaryCleanupDidNotRemoveSentinel: true,
            casesClosed: 0,
            gatesClosed: 0,
          }),
      );
    },
    remove() {
      if (attached) throw Error('Owned sentinel still attached');
      if (witness() !== before) throw Error('Owned sentinel witness changed');
      call(['rm', '--force', id]);
      const v = JSON.parse(call(['volume', 'inspect', volume]))[0];
      if (v.Labels?.['fixture.custody'] !== token) throw Error('Owned volume identity changed');
      call(['volume', 'rm', volume]);
      const net = JSON.parse(call(['network', 'inspect', project + '_local']))[0];
      if (net.Labels?.['fixture.custody'] !== token) throw Error('Owned network identity changed');
      call(['network', 'rm', project + '_local']);
      assertFresh(project);
      unlinkSync(custodyFile);
      console.log(
        'RR_SENTINEL_CLEANUP ' + JSON.stringify({ ownedSentinelRemoved: true, unknown: false }),
      );
    },
  };
}
