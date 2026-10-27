import type { EnvironmentPlan } from './plan.mjs';
export function persistentHostPlan(target: string): EnvironmentPlan & { readonly hostPort: number };
