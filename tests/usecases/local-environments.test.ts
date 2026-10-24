import { describe, expect, it } from 'vitest';
// The host CLI is plain ESM so Windows, WSL and Linux can use the same implementation.
import {
  environmentPlan,
  composeArguments,
  validateEnvironmentFile,
} from '../../scripts/dev/plan.mjs';

describe('ENG-06 operator manages local environments', () => {
  it('accepts generated local values and rejects another environment or native port', () => {
    const plan = environmentPlan('dev');
    const text = `LOCAL_ENV=dev\nCOMPOSE_PROJECT_NAME=tt-dev\nAPP_ENV=dev-local\nAPP_PORT=3100\nDATABASE_PORT=55432\nPOSTGRES_PASSWORD=${'a'.repeat(64)}\n`;
    expect(validateEnvironmentFile(plan, text).APP_ENV).toBe('dev-local');
    expect(() => validateEnvironmentFile(plan, text.replace('55432', '5432'))).toThrow();
    expect(() => validateEnvironmentFile(environmentPlan('stage'), text)).toThrow();
    expect(() => validateEnvironmentFile(plan, text + 'DATABASE_URL=external\n')).toThrow();
  });
  it('uses independent projects, files and ports for dev and stage', () => {
    const dev = environmentPlan('dev');
    const stage = environmentPlan('stage');
    expect(dev.project).not.toBe(stage.project);
    expect(dev.envFile).not.toBe(stage.envFile);
    expect(dev.appPort).not.toBe(stage.appPort);
    expect(dev.databasePort).not.toBe(stage.databasePort);
    expect([dev.databasePort, stage.databasePort]).not.toContain(5432);
  });
  it('down preserves local data volumes', () => {
    const args = composeArguments(environmentPlan('dev'), ['down']);
    expect(args).toContain('tt-dev');
    expect(args).not.toContain('--volumes');
  });
  it.each(['prod', 'production', '../stage', 'native', 'test'])(
    'rejects unsafe target %s',
    (target) => {
      expect(() => environmentPlan(target)).toThrow();
    },
  );
  it('allocates only explicitly identified disposable test projects', () => {
    const a = environmentPlan('test', 'a1b2c3d4');
    const b = environmentPlan('test', 'b1c2d3e4');
    expect(a.project).not.toBe(b.project);
    expect(a.project).toBe('tt-test-a1b2c3d4');
    expect(composeArguments(a, ['up'])).toContain('infra/local/compose.test.yaml');
    expect(a.databasePort).toBe(0);
    expect(() => environmentPlan('test', '../prod')).toThrow();
  });
});
