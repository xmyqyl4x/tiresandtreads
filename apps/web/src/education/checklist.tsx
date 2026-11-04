import type { ChecklistTool, EducationPage } from '../../../../packages/contracts/src/education.ts';
export function BuyingChecklist({
  page,
  tool,
}: {
  page: EducationPage['content'];
  tool?: ChecklistTool;
}) {
  if (!page.questions) return null;
  return (
    <section>
      <h2>Your conversation checklist.</h2>
      <p>
        Record written answers and questions that need clarification. The summary does not certify a
        shop or verify tire safety. Print this page using your browser, or use the print button.
      </p>
      <form
        method="get"
        action="/guides/before-you-buy"
        id="buying-checklist"
        data-revision={page.modifiedAt}
      >
        {page.questions.map((q) => (
          <fieldset className="checklist-question" key={q.key}>
            <legend>
              {q.key}. {q.question}
            </legend>
            <p>
              <strong>Good answer:</strong> {q.goodAnswer}
            </p>
            <p>
              <strong>Ask for clarification:</strong> {q.redFlags.join(' ')}
            </p>
            <p>
              <a href={q.glossaryPath}>Read the related term</a>
            </p>
            <label>
              <input type="checkbox" className="print-checkbox" /> Discussed with the installer
            </label>
            <label htmlFor={'answer-' + q.key}>Record your answer</label>
            <select
              id={'answer-' + q.key}
              name={'answer-' + q.key}
              defaultValue={tool?.answers.find((a) => a.key === q.key)?.answer ?? 'unknown'}
            >
              <option value="unknown">Unanswered / not sure</option>
              <option value="good">Answer recorded</option>
              <option value="concern">Needs clarification</option>
            </select>
          </fieldset>
        ))}
        <button className="button primary" type="submit">
          Summarize my answers
        </button>
        <button className="button secondary" type="button" data-checklist="print">
          Print checklist
        </button>
        <div className="checklist-storage">
          <h3>Optional device storage</h3>
          <p>
            These 14 choices can stay in this browser for up to 30 days. They are not added to an
            account. Saving and loading require your permission; shared devices can expose saved
            choices. No names or free-text notes are stored.
          </p>
          <label>
            <input type="checkbox" id="checklist-storage-permission" /> Allow saving and loading my
            choices on this device
          </label>
          <button type="button" className="button secondary" data-checklist="save">
            Save choices on this device
          </button>
          <button type="button" className="button secondary" data-checklist="load">
            Load saved choices
          </button>
          <button type="button" className="button secondary" data-checklist="clear">
            Delete saved choices
          </button>
          <p id="checklist-storage-status" role="status">
            Nothing is saved automatically. These optional controls require JavaScript.
          </p>
        </div>
      </form>
      {tool ? (
        <div className="education-tool-result" role="status">
          <h3>Conversation summary</h3>
          <p>
            {tool.result.good} answers recorded · {tool.result.concerns} need clarification ·{' '}
            {tool.result.unknown} unanswered
          </p>
          <p>
            {tool.result.summary === 'discuss_concerns'
              ? 'Discuss the concerns before deciding.'
              : tool.result.summary === 'incomplete'
                ? 'There are unanswered questions to follow up.'
                : 'All answers are recorded. This is not a safety or shop-competency assessment.'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
