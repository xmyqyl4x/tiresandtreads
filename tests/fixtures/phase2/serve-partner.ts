import { value } from './compose-partner-services.ts';
import { partnerWebFixture } from './partner-web.ts';
if (process.argv.length !== 2) throw Error('Disposable partner preview accepts no arguments');
const fixture = await partnerWebFixture('http://127.0.0.1:8380');
const invited = fixture.p.session(),
  intended = fixture.p.sessions.get(invited)!;
const invitation = value(
  await fixture.p.onboarding.invite(
    fixture.company.handle,
    fixture.company.org,
    intended.subject,
    'analyst',
  ),
);
console.log(
  'LOCAL_P2_PARTNER_READY ' +
    JSON.stringify({
      origin: fixture.web.webOrigin,
      organization: fixture.company.org,
      partnerCredential: fixture.company.handle,
      newPartnerCredential: fixture.newPartner,
      invitedCredential: invited,
      invitationToken: invitation.token,
      syntheticIdentity: true,
      disposable: true,
      actualAcceptance: false,
      providerDispatches: 0,
      actualRecipientNotifications: 0,
      casesClosed: 0,
      gatesClosed: 0,
    }),
);
try {
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await fixture.cleanup();
}
