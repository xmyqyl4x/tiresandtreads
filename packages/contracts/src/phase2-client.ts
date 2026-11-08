import { z, p2Uuid } from './phase2-wire.ts';
import { createApiClient, type ApiReply } from './transport.ts';
import type { EndpointContract } from './http.ts';
export interface P2Command {
  readonly key: string;
  readonly csrf: string;
}
export function p2Operation<
  I extends z.ZodType | undefined,
  Q extends z.ZodType,
  O extends z.ZodType,
  C extends boolean,
  B extends boolean = false,
>(contract: EndpointContract, input: I, output: O, query: Q, command: C, binary: B = false as B) {
  return { contract, input, output, query, command, binary };
}
type Definition = ReturnType<typeof p2Operation>;
type Call<D extends Definition> = {
  readonly path?: Readonly<Record<string, string>>;
  readonly query?: z.input<D['query']>;
  readonly signal?: AbortSignal;
} & (D['command'] extends true ? { readonly command: P2Command } : { readonly command?: never }) &
  (D['binary'] extends true
    ? { readonly bytes: Uint8Array; readonly grant?: string }
    : D['input'] extends z.ZodType
      ? { readonly body: z.input<D['input']> }
      : { readonly body?: never });
export type P2Client<T extends Readonly<Record<string, Definition>>> = {
  readonly [K in keyof T]: (input: Call<T[K]>) => Promise<ApiReply<z.output<T[K]['output']>>>;
};
// No credential storage, retry, authority inference or effect dispatch. The caller owns its
// session transport, CSRF and command key. A409 requires a new authorized read/reconciliation.
export function createP2Client<T extends Readonly<Record<string, Definition>>>(
  definitions: T,
  base: string,
  transport: typeof fetch,
): P2Client<T> {
  const api = createApiClient(base, transport);
  return Object.fromEntries(
    Object.entries(definitions).map(([name, d]) => [
      name,
      async (raw: Call<typeof d>) => {
        const expected = [...d.contract.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
        const pathInput = z
          .strictObject(
            Object.fromEntries(
              expected.map((k) => [
                k,
                k === 'version'
                  ? z
                      .string()
                      .regex(/^[1-9][0-9]{0,9}$/)
                      .refine((v) => Number(v) <= 2147483647)
                  : p2Uuid,
              ]),
            ),
          )
          .parse(raw.path ?? {});
        let path = d.contract.path.replace(/:([A-Za-z]+)/g, (_s, k: string) =>
          encodeURIComponent(pathInput[k]!),
        );
        const query = d.query.parse(raw.query ?? {}) as Record<string, unknown>;
        const encoded = new URLSearchParams(
          Object.entries(query)
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        );
        if (encoded.size) path += '?' + encoded;
        const headers = new Headers();
        let body: string | ArrayBuffer | undefined;
        if (d.command) {
          const c = z
            .strictObject({ key: z.string().min(1).max(200), csrf: z.string().min(1).max(2048) })
            .parse(raw.command);
          headers.set('x-csrf-token', c.csrf);
          headers.set('idempotency-key', c.key);
        }
        if (d.binary) {
          const bytes = z
            .instanceof(Uint8Array)
            .refine((v) => v.byteLength > 0 && v.byteLength <= (d.contract.maxBodyBytes ?? 0))
            .parse('bytes' in raw ? raw.bytes : undefined);
          body = Uint8Array.from(bytes).buffer;
          headers.set('content-type', 'application/octet-stream');
          if (name === 'p2PhotoFinalize')
            headers.set(
              'x-upload-grant',
              z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .parse('grant' in raw ? raw.grant : undefined),
            );
          else if ('grant' in raw && raw.grant !== undefined)
            throw Error('Unexpected upload grant');
        } else if (d.input) {
          body = JSON.stringify(d.input.parse('body' in raw ? raw.body : undefined));
          headers.set('content-type', 'application/json');
        }
        const reply = await api.request<unknown>(path, {
          method: d.contract.method,
          headers,
          credentials: d.contract.access === 'owner' ? 'same-origin' : 'omit',
          ...(body === undefined ? {} : { body }),
          ...(raw.signal ? { signal: raw.signal } : {}),
        });
        return { ...reply, data: d.output.parse(reply.data) };
      },
    ]),
  ) as unknown as P2Client<T>;
}
