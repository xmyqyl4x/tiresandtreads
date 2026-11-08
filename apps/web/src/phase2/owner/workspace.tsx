import { useState } from 'react';
import { createPhotoPresentationClient } from '../../../../../packages/contracts/src/phase2-photo-presentation-client.ts';
import { assessmentController } from '../../assessment/controller.ts';
import { AssessmentForm } from '../../ui/assessment-form.tsx';
import { PhotoPanel } from './photos.tsx';
import type { ConfirmedSizeApplication } from '../../assessment/model.ts';
import { createP2OwnerClient } from '../../../../../packages/contracts/src/phase2-owner-client.ts';
import { createP2PresentationClient } from '../../../../../packages/contracts/src/phase2-presentation-client.ts';
import { createApiClient } from '../../../../../packages/contracts/src/transport.ts';
import { createResultsClient } from '../../../../../packages/contracts/src/results-client.ts';
import { createDeliveryPrivacyClient } from '../../../../../packages/contracts/src/delivery-privacy-client.ts';
import { z } from '../../../../../packages/contracts/src/phase2-wire.ts';
import type { OwnerReportView } from '../../../../../packages/contracts/src/report-views.ts';
import { Workbench, privateTransport, Field, ActionForm, type Workspace } from '../workbench.tsx';
import { reportReference } from './forms.ts';
import { AssistedReport } from './report.tsx';
import { ReportBody } from '../../ui/report-body.tsx';
import type { OwnerClients } from './types.ts';
function clients(base: string, send: typeof fetch, csrf: string): OwnerClients {
  return {
    photos: createPhotoPresentationClient(base, send),
    assessment: assessmentController(
      base,
      send,
      () => crypto.randomUUID(),
      async () => ({ csrf }),
    ),
    analysis: createP2OwnerClient(base, send),
    presentation: createP2PresentationClient(base, send),
    reports: createResultsClient(base, send),
    delivery: createDeliveryPrivacyClient(base, send),
  };
}
async function connect(bearer: string, signal: AbortSignal) {
  const base = window.location.origin,
    send = privateTransport(base, bearer, signal, fetch, 'owner');
  const response = await createApiClient(base, send).request('/api/v1/sessions/current');
  const session = z.object({ csrf: z.string().regex(/^[a-f0-9]{64}$/) }).parse(response.data);
  return { client: clients(base, send, session.csrf), csrf: session.csrf };
}
function OwnerSpace({ w }: { w: Workspace<OwnerClients> }) {
  const [report, setReport] = useState<OwnerReportView | null>(null);
  const [confirmedSize, setConfirmedSize] = useState<ConfirmedSizeApplication | null>(null);
  return (
    <>
      <section aria-label="Assessment and optional photo entry" className="staff-card">
        <h2>Start with your tire details</h2>
        <p>
          Manual entry is always available. Photo suggestions do not populate the assessment until
          you confirm and explicitly apply a size.
        </p>
        <PhotoPanel w={w} onApply={setConfirmedSize} />
        <AssessmentForm
          controller={w.client.assessment}
          confirmedSize={confirmedSize}
          disabled={w.busy || w.blocked}
          onAccessFailure={(e) =>
            void w.read(
              'Assessment authorization',
              () => Promise.reject(e),
              () => {},
            )
          }
          onOpen={(report) =>
            void w.read('Recorded report', () => w.client.reports.read(report, 1), setReport)
          }
        />
      </section>
      <ActionForm
        title="Open recorded report"
        disabled={w.busy}
        action={async (f) => {
          const ref = reportReference(f);
          await w.read(
            'Recorded report',
            () => w.client.reports.read(ref.report, ref.version),
            setReport,
          );
        }}
      >
        <Field name="report" label="Report reference" required />
        <Field
          name="version"
          label="Report version"
          type="number"
          min="1"
          max="2147483647"
          value="1"
          required
        />
      </ActionForm>
      <p>
        <a href="/preview/find-tires">Start an assessment with manual entry</a>
      </p>
      {report ? (
        <>
          <h2>Recorded report {report.version}</h2>
          <p>
            <code>{report.reportId}</code> · immutable version {report.version}. Assistance is
            optional and never changes these facts.
          </p>
          <AssistedReport key={report.reportId + ':' + report.version} w={w} report={report} />
          <ReportBody output={report.output} safety={report.safety} version={report.version} />
        </>
      ) : (
        <p>Open a report you own. No assistance or email is requested by opening it.</p>
      )}
    </>
  );
}
export function OwnerWorkspace() {
  return (
    <Workbench title="Your report and optional assistance" connect={connect}>
      {(w) => <OwnerSpace w={w} />}
    </Workbench>
  );
}
