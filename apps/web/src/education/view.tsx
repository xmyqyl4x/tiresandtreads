import type { ReactNode } from 'react';
import type {
  EducationPage,
  EducationTool,
  ChecklistTool,
} from '../../../../packages/contracts/src/education.ts';
import { BuyingChecklist } from './checklist.tsx';
import { EditorialDiagram } from './diagram.tsx';
const groups = [
  { title: 'Reading the sidewall', topics: ['size'] },
  { title: 'Ratings and labels', topics: ['ratings'] },
  { title: 'Tire types', topics: ['types', 'winter', 'wet', 'heat', 'off_road', 'run_flat'] },
  { title: 'Maintenance', topics: ['maintenance'] },
  { title: 'Buying', topics: ['buying', 'warranty', 'noise', 'efficiency', 'ev'] },
];
function markingRows(result: EducationTool['result']) {
  if (result.status !== 'decoded') return [];
  return [
    ['Type', result.type ?? 'Unspecified'],
    ['Nominal width', result.widthMm + ' mm'],
    ['Aspect ratio', result.aspectPercent + '%'],
    ['Construction', 'Radial'],
    ['Wheel diameter', result.rimInches + ' in'],
    [
      'Load index',
      result.loadIndex === null ? 'Not specified' : String(result.loadIndex) + ' (code only)',
    ],
    [
      'Speed symbol',
      result.speedCode === null ? 'Not specified' : result.speedCode + ' (code only)',
    ],
    ['Load capacity', 'Not decoded'],
    ['Speed limit', 'Not decoded'],
  ];
}
export function EducationLayout({ children, path }: { children: ReactNode; path?: string }) {
  return (
    <>
      <a className="skip-link" href="#education-main">
        Skip to content
      </a>
      <header className="site-header education-header">
        <div className="container header-inner">
          <a className="brand" href="/">
            TIRES &amp; TREAD
          </a>
          <nav aria-label="Main" className="education-nav">
            <a
              href="/preview/find-tires"
              aria-current={path === '/preview/find-tires' ? 'page' : undefined}
            >
              Find tires
            </a>
            <a
              href="/learn/tire-basics"
              aria-current={path === '/learn/tire-basics' ? 'page' : undefined}
            >
              Tire basics
            </a>
            <a
              href="/guides/size-decoder"
              aria-current={path === '/guides/size-decoder' ? 'page' : undefined}
            >
              Size decoder
            </a>
            <a
              href="/guides/before-you-buy"
              aria-current={path === '/guides/before-you-buy' ? 'page' : undefined}
            >
              Before you buy
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="education-footer container">
        <p>Clear evidence. Visible limits. Your choice.</p>
        <a href="/guides/how-we-choose">How we choose</a> · <a href="/guides/trust">Trust</a> ·{' '}
        <a href="/guides/support">Support</a> · <a href="/preview/privacy">Privacy choices</a>
      </footer>
    </>
  );
}
export function EducationView({
  page,
  tool,
  checklist,
}: {
  page: EducationPage;
  tool?: EducationTool;
  checklist?: ChecklistTool;
}) {
  const p = page.content,
    hub = ['/learn/tire-basics', '/learn/glossary'].includes(p.path),
    terms = (page.navigation?.items ?? []).filter((item) => item.kind === 'glossary');
  return (
    <EducationLayout path={p.path}>
      <main id="education-main" tabIndex={-1}>
        <div className="education-hero">
          <div className="container">
            <p className="eyebrow">
              THE TIRE NOTEBOOK · {p.kind === 'glossary' ? 'GLOSSARY' : 'GUIDE'}
            </p>
            <h1>{p.title}</h1>
            <p className="education-summary">{p.summary}</p>
            <p className="education-local">
              Local development preview · example editorial workflow; live acceptance remains
              pending.
            </p>
          </div>
        </div>
        <div className="container education-grid">
          <article className="education-article">
            <nav aria-label="Breadcrumb">
              <a href="/learn/tire-basics">Tire basics</a>
              <span aria-hidden="true"> / </span>
              <span>{p.title}</span>
            </nav>
            <div className="education-prose">
              {p.paragraphs.map((text, i) => (
                <div key={i}>
                  {p.kind === 'glossary' && i < 3 ? (
                    <h2>
                      {['Plain definition', 'Why it matters to you', 'A common misconception'][i]}
                    </h2>
                  ) : null}
                  <p>{text}</p>
                </div>
              ))}
            </div>
            {p.kind === 'glossary' ? (
              <>
                <EditorialDiagram title={p.title} />
                <h2>Regional context</h2>
                <p>
                  This page is the US English edition. Check the exact vehicle documentation and the
                  relevant local authority before applying information to another market. No local
                  legal requirement is inferred from a tire marking.
                </p>
                <a className="button primary" href="/preview/find-tires">
                  Find tires for your needs
                </a>
              </>
            ) : null}
            {hub ? (
              <>
                <h2>Find a useful starting point.</h2>
                <div className="education-tools">
                  <a className="card" href="/guides/size-decoder">
                    <span className="eyebrow">READ THE SIDEWALL</span>
                    <h3>Decode a size</h3>
                    <p>Understand the marking. Keep suitability separate.</p>
                  </a>
                  <a className="card" href="/guides/before-you-buy">
                    <span className="eyebrow">BEFORE YOU BUY</span>
                    <h3>Ask better questions</h3>
                    <p>Record answers, gaps and written assumptions.</p>
                  </a>
                </div>
                <h2 id="glossary-heading">A practical glossary.</h2>
                {groups.map((group, i) => (
                  <section key={group.title}>
                    <h3 id={'glossary-group-' + i}>{group.title}</h3>
                    <ul className="glossary-grid" aria-labelledby={'glossary-group-' + i}>
                      {terms
                        .filter((term) => group.topics.includes(term.topics[0]!))
                        .map((term) => (
                          <li key={term.path}>
                            <a href={term.path}>
                              {term.title}
                              <span aria-hidden="true"> ↗</span>
                            </a>
                          </li>
                        ))}
                    </ul>
                  </section>
                ))}
                {page.navigation?.hasMore ? (
                  <p>
                    More content is available; this local hub shows the current bounded catalog.
                  </p>
                ) : null}
              </>
            ) : null}
            {p.path === '/guides/size-decoder' ? (
              <section className="card">
                <h2>What does your marking say?</h2>
                <form method="get" action="/guides/size-decoder">
                  <label htmlFor="tire-marking">Metric tire-size marking</label>
                  <input
                    name="marking"
                    id="tire-marking"
                    maxLength={80}
                    placeholder="235/60R18 103H"
                    defaultValue={tool?.input ?? ''}
                    required
                  />
                  <button className="button primary">Decode marking</button>
                </form>
                {tool ? (
                  <div className="education-tool-result" role="status">
                    <h3>Descriptive result</h3>
                    {tool.result &&
                    typeof tool.result === 'object' &&
                    'status' in tool.result &&
                    tool.result.status === 'decoded' ? (
                      <>
                        <dl>
                          {markingRows(tool.result).map(([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{String(value)}</dd>
                            </div>
                          ))}
                        </dl>
                        <p>
                          Fitment is not verified. Check the complete vehicle and tire
                          specifications.
                        </p>
                      </>
                    ) : (
                      <p>This format is unsupported. No size or suitability result was invented.</p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}
            {p.questions ? (
              <BuyingChecklist page={p} {...(checklist ? { tool: checklist } : {})} />
            ) : null}
            {p.references?.length ? (
              <section className="education-sources">
                <h2>Sources to read.</h2>
                <ul>
                  {p.references.map((r) => (
                    <li key={r.url}>
                      <a href={r.url} rel="noopener noreferrer">
                        {r.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {p.related.length && !hub ? (
              <section>
                <h2>Keep learning.</h2>
                <ul>
                  {p.related.map((path) => (
                    <li key={path}>
                      <a href={path}>{path.split('/').at(-1)?.replace(/-/g, ' ')}</a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
          <aside className="education-aside">
            <section className="card">
              <p className="eyebrow">ABOUT THIS PAGE</p>
              <h2>Evidence, in context.</h2>
              <dl>
                <dt>Author</dt>
                <dd>{p.author}</dd>
                <dt>Reviewer</dt>
                <dd>{p.reviewer}</dd>
                <dt>Reviewed</dt>
                <dd>
                  <time dateTime={p.reviewedAt}>{p.reviewedAt.slice(0, 10)}</time>
                </dd>
                <dt>Review valid through</dt>
                <dd>
                  <time dateTime={p.expiresAt}>{p.expiresAt.slice(0, 10)}</time>
                </dd>
              </dl>
              <p className="hint">
                A definition or decoded marking is not a tire inspection or vehicle-specific
                approval.
              </p>
            </section>
            <section className="education-note">
              <p className="eyebrow">KEEP THE CHOICE YOURS</p>
              <h3>See the method.</h3>
              <p>Understand how evidence, prices and preference scores stay separate.</p>
              <a href="/guides/how-we-choose">How we choose →</a>
            </section>
          </aside>
        </div>
      </main>
    </EducationLayout>
  );
}
