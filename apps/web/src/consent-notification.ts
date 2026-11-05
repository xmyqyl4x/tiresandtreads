// An invalidation contains no choices, owner identifiers or credential. It cannot grant permission.
export function invalidateCommercialConsent() {
  window.dispatchEvent(new Event('tt-consent-changed'));
  try {
    const channel = new BroadcastChannel('tt-privacy');
    channel.postMessage('invalidate');
    channel.close();
  } catch {
    /* no tag depends on this channel */
  }
}
