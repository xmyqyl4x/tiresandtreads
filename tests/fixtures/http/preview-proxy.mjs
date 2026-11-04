import { createServer, request as upstream } from 'node:http';
import { randomUUID } from 'node:crypto';
import { previewForwardHeaders } from './preview-headers.mjs';
const mode = process.env.LOCAL_PREVIEW_MODE;
if (!['dev', 'stage'].includes(mode) || process.env.PROVIDER_MODE !== 'fixtures')
  throw Error('Local preview proxy refused');
const authority = '127.0.0.1:' + (mode === 'dev' ? 8380 : 8480);
let active = 0;
function refuse(response, status, code) {
  const requestId = randomUUID();
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
    'x-request-id': requestId,
    connection: 'close',
  });
  response.end(
    JSON.stringify({
      code,
      messageKey: 'errors.' + code,
      fieldErrors: {},
      retryable: status === 503,
      requestId,
    }),
  );
}
function body(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 65536) {
        reject(Error('body_limit'));
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks)));
    request.once('error', reject);
    request.setTimeout(5000, () => {
      reject(Error('body_timeout'));
    });
  });
}
const server = createServer(async (incoming, outgoing) => {
  if (
    incoming.headers.host !== authority ||
    !incoming.url?.startsWith('/') ||
    incoming.url.startsWith('//') ||
    incoming.url.length > 4096
  ) {
    refuse(outgoing, 403, 'forbidden');
    return;
  }
  if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(incoming.method)) {
    refuse(outgoing, 405, 'method_not_allowed');
    return;
  }
  if (active >= 32) {
    refuse(outgoing, 503, 'unavailable');
    return;
  }
  active++;
  try {
    const bytes = await body(incoming),
      headers = previewForwardHeaders(incoming.headers, authority, incoming.url, incoming.method);
    if (!['GET', 'HEAD'].includes(incoming.method))
      headers['content-length'] = String(bytes.length);
    await new Promise((resolve, reject) => {
      // Fixed Docker service only. Caller URL/Host/forwarded headers cannot select an upstream authority.
      const sent = upstream(
        {
          hostname: 'test',
          port: 3000,
          path: incoming.url,
          method: incoming.method,
          headers,
          agent: false,
          timeout: 10000,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 503, response.headers);
          response.pipe(outgoing);
          response.once('end', resolve);
          response.once('error', reject);
        },
      );
      sent.once('error', reject);
      sent.once('timeout', () => sent.destroy(Error('upstream_timeout')));
      sent.end(bytes);
      outgoing.once('close', () => sent.destroy());
    });
  } catch (error) {
    if (!outgoing.headersSent)
      refuse(
        outgoing,
        error.message === 'body_limit' ? 413 : error.message === 'body_timeout' ? 408 : 503,
        error.message === 'body_limit'
          ? 'body_too_large'
          : error.message === 'body_timeout'
            ? 'request_timeout'
            : 'unavailable',
      );
    else outgoing.end();
  } finally {
    active--;
  }
});
server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.keepAliveTimeout = 1000;
server.listen(3000, '0.0.0.0', () =>
  console.log('Loopback preview proxy ready; fixed internal upstream only'),
);
