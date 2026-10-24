export interface EnvironmentPlan {
  readonly target: 'dev' | 'stage' | 'test';
  readonly project: string;
  readonly envFile: string;
  readonly appPort: number;
  readonly databasePort: number;
  readonly appEnv: string;
}
export function environmentPlan(target: string, runId?: string): EnvironmentPlan;
export function composeArguments(plan: EnvironmentPlan, command: readonly string[]): string[];
export function validateEnvironmentFile(
  plan: EnvironmentPlan,
  text: string,
): Readonly<Record<string, string>>;
