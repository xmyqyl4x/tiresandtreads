import { ComparisonScreen } from './comparison-screen.tsx';
import { SharedScreen } from './shared-screen.tsx';
import { Link } from './link.tsx';
import { Shell } from './shell.tsx';
import { ComponentDemo } from './component-demo.tsx';
import { AssessmentForm } from './assessment-form.tsx';
import { ReportScreen } from './report-screen.tsx';
const pages: Record<string, { title: string; text: string }> = {
  compare: { title: 'Compare your options', text: 'Private comparison, shop quotes and sharing' },
  shared: { title: 'Shared technical report', text: 'Read-only redacted view' },
  report: { title: 'Your technical report', text: 'Private saved results and refinement' },
  'find-tires': {
    title: 'Find your next set.',
    text: 'The assessment form is the next part of the experience. This preview lets you review the shared navigation and controls.',
  },
  'tire-basics': {
    title: 'Understand the basics.',
    text: 'Reviewed tire guides are being prepared. This preview shows how you will find them.',
  },
  'size-decoder': {
    title: 'Make sense of the sidewall.',
    text: 'The size tool will explain the numbers on your tire. Its interactive screen is coming in a later preview.',
  },
  'before-you-buy': {
    title: 'Bring the right questions.',
    text: 'The buying tools will show the information available for each option, including gaps and limitations.',
  },
  'how-we-choose': {
    title: 'Clear reasons for every choice.',
    text: 'Recommendations will explain their evidence and limitations. Specialist review and supported data remain required before live tire advice.',
  },
  privacy: {
    title: 'Your choices stay yours.',
    text: 'Optional permissions start off. Use Privacy choices below to review or change your current preferences. This preview runs no advertising or analytics services.',
  },
};
function Home() {
  return (
    <Shell>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">TIRES &amp; TREAD</p>
            <h1>
              Your next set.
              <br />
              <span>A clearer choice.</span>
            </h1>
            <p className="hero-copy">
              Tire choices should make sense. We’re building a place to understand the details,
              compare your options and decide with confidence.
            </p>
            <div className="actions">
              <Link className="button primary" href="/preview/find-tires">
                Find tires <span aria-hidden="true">→</span>
              </Link>
              <Link className="plain-link" href="/preview/how-we-choose">
                How we choose
              </Link>
            </div>
            <p className="hint">
              A local preview. Assessments and shopping features are still being built.
            </p>
          </div>
          <div className="tire-illustration" aria-hidden="true">
            <svg viewBox="0 0 420 420" width="420" height="420">
              <defs>
                <pattern
                  id="tread"
                  width="24"
                  height="24"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(25)"
                >
                  <path d="M0 0v24M12 0v24" stroke="#52606D" strokeWidth="5" />
                </pattern>
              </defs>
              <circle cx="210" cy="210" r="178" fill="#F5C928" />
              <circle cx="210" cy="210" r="143" fill="#1C2023" />
              <circle cx="210" cy="210" r="121" fill="url(#tread)" />
              <circle cx="210" cy="210" r="82" fill="#F3F4F4" />
              <circle cx="210" cy="210" r="62" fill="#D8DEE3" />
              <path
                d="M210 158v104M158 210h104M173 173l74 74M173 247l74-74"
                stroke="#7B8794"
                strokeWidth="15"
              />
              <circle cx="210" cy="210" r="21" fill="#1C2023" />
            </svg>
            <span>MAKE SENSE OF THE DETAILS</span>
          </div>
        </div>
      </section>
      <section className="container overview">
        <div className="section-heading">
          <p className="eyebrow">BUILT AROUND YOUR CHOICE</p>
          <h2>A practical place to start.</h2>
          <p>Clear explanations. Useful comparisons. Room to make your own decision.</p>
        </div>
        <div className="three-columns">
          {[
            [
              '01',
              'Understand the fit',
              'Start with the details that matter to your vehicle and your driving.',
            ],
            [
              '02',
              'Compare with context',
              'See what’s known, what’s missing and what needs a closer look.',
            ],
            [
              '03',
              'Keep the choice yours',
              'Explore the information without an email or advertising gate.',
            ],
          ].map(([n, title, text]) => (
            <article className="card" key={n}>
              <span className="step-number">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="container preview-panel">
        <div>
          <p className="eyebrow">PREVIEW THE FOUNDATION</p>
          <h2>One consistent experience.</h2>
          <p>Try the controls, review the layout and adjust your privacy choices.</p>
        </div>
        <Link className="button secondary" href="/design-system">
          Review components
        </Link>
      </section>
    </Shell>
  );
}
function DesignSystem() {
  return (
    <Shell path="/design-system">
      <div className="container page-heading">
        <p className="eyebrow">DESIGN FOUNDATION</p>
        <h1>Clear, consistent, accessible.</h1>
        <p>
          Review the shared controls and the ways we explain loading, missing information and
          errors.
        </p>
      </div>
      <div className="container">
        <ComponentDemo />
      </div>
    </Shell>
  );
}

export function pageTitle(page: string) {
  return page === 'home'
    ? 'Your next set. A clearer choice.'
    : page === 'design-system'
      ? 'Design system'
      : Object.hasOwn(pages, page)
        ? pages[page]!.title
        : null;
}
export function PageView({ page }: { page: string }) {
  if (page === 'home') return <Home />;
  if (page === 'design-system') return <DesignSystem />;
  if (page === 'compare')
    return (
      <Shell path="/preview/compare">
        <section className="container page-heading">
          <p className="eyebrow">YOUR COMPARISON</p>
          <h1>Compare the details.</h1>
          <p>Your saved options, shop quotes and explicit assumptions.</p>
        </section>
        <div className="container report-view">
          <ComparisonScreen />
        </div>
      </Shell>
    );
  if (page === 'shared')
    return (
      <Shell path="/preview/shared">
        <section className="container page-heading">
          <p className="eyebrow">SHARED REPORT</p>
          <h1>A view you can review.</h1>
          <p>A redacted, read-only technical report shared with you.</p>
        </section>
        <div className="container report-view">
          <SharedScreen />
        </div>
      </Shell>
    );
  if (page === 'report')
    return (
      <Shell path="/preview/report">
        <section className="container page-heading">
          <p className="eyebrow">YOUR SAVED ASSESSMENT</p>
          <h1>Understand the evidence.</h1>
          <p>Your private technical results, current safety overlay and versioned refinements.</p>
        </section>
        <div className="container report-view">
          <ReportScreen />
        </div>
      </Shell>
    );
  if (page === 'find-tires')
    return (
      <Shell path="/preview/find-tires">
        <section className="container page-heading">
          <p className="eyebrow">YOUR NEXT SET</p>
          <h1>Start with the details.</h1>
          <p>Tell us about your vehicle, tires and driving. Unknown information stays unknown.</p>
        </section>
        <div className="container narrow">
          <AssessmentForm />
        </div>
      </Shell>
    );
  const selected = Object.hasOwn(pages, page) ? pages[page] : null;
  if (!selected) return null;
  return (
    <Shell path={'/preview/' + page}>
      <section className="container page-heading narrow">
        <p className="eyebrow">EXPERIENCE PREVIEW</p>
        <h1>{selected.title}</h1>
        <p>{selected.text}</p>
        <Link className="button primary" href="/design-system">
          Review the design system
        </Link>
      </section>
    </Shell>
  );
}
