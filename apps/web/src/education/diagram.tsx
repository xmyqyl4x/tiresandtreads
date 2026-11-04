export function EditorialDiagram({ title }: { title: string }) {
  return (
    <figure className="editorial-diagram">
      <svg
        viewBox="0 0 620 210"
        role="img"
        aria-label={title + ': read the evidence, check the specification, ask for clarification'}
      >
        <title>{title}: a reading and verification guide</title>
        <circle cx="105" cy="104" r="75" fill="none" stroke="currentColor" strokeWidth="18" />
        <circle cx="105" cy="104" r="40" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M165 60H245M175 105H245M165 150H245"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <text x="260" y="65">
          01 · Read the marking or evidence
        </text>
        <text x="260" y="110">
          02 · Check the complete specification
        </text>
        <text x="260" y="155">
          03 · Ask what remains unverified
        </text>
      </svg>
      <figcaption>
        Original schematic for {title.toLowerCase()}. Illustrative only; not a measured tire or a
        fitment approval.
      </figcaption>
    </figure>
  );
}
