export function environmentPlan(target, runId) {
  if (target === 'test') {
    if (!/^[a-f0-9]{8,32}$/.test(runId ?? ''))
      throw new Error('A disposable test run ID is required');
    return {
      target,
      project: `tt-test-${runId}`,
      envFile: `.local/test-${runId}.env`,
      appPort: 0,
      databasePort: 0,
      appEnv: 'test-local',
    };
  }
  if (target !== 'dev' && target !== 'stage')
    throw new Error('Target must be dev, stage or an identified test run');
  return {
    target,
    project: `tt-${target}`,
    envFile: `.local/${target}.env`,
    appPort: target === 'dev' ? 3100 : 3200,
    databasePort: target === 'dev' ? 55432 : 55433,
    appEnv: `${target}-local`,
  };
}

export function composeArguments(plan, command) {
  const args = [
    'compose',
    '--project-name',
    plan.project,
    '--env-file',
    plan.envFile,
    '-f',
    'infra/local/compose.yaml',
  ];
  if (plan.target === 'dev') args.push('-f', 'infra/local/compose.dev.yaml');
  if (plan.target === 'test') args.push('-f', 'infra/local/compose.test.yaml');
  return [...args, ...command];
}

export function validateEnvironmentFile(plan, text) {
  const values = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  const expected = {
    LOCAL_ENV: plan.target,
    COMPOSE_PROJECT_NAME: plan.project,
    APP_ENV: plan.appEnv,
    APP_PORT: String(plan.appPort),
    DATABASE_PORT: String(plan.databasePort),
  };
  if (
    Object.entries(expected).some(([key, value]) => values[key] !== value) ||
    !/^[a-f0-9]{64}$/.test(values.POSTGRES_PASSWORD ?? '') ||
    Object.keys(values).length !== 6
  ) {
    throw new Error('Local environment file does not match the selected isolated target');
  }
  return values;
}
