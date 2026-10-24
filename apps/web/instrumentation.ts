import { readRuntimeConfig } from '@tt/config/runtime';

export function register(): void {
  readRuntimeConfig(process.env);
}
