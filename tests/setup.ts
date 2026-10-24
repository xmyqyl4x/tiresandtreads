import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

export const fixtureServer = setupServer();
beforeAll(() => fixtureServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => fixtureServer.resetHandlers());
afterAll(() => fixtureServer.close());
