import type { ReferenceNote } from '@/lib/ai/reference-types';

export function ReferenceNotes({ notes }: { notes?: ReferenceNote[] }) {
  if (!notes?.length) return null;
  return (
    <details className="reference-notes">
      <summary className="text-link">Reuse references ({notes.length})</summary>
      <p className="field-hint">
        Conditional reference notes from a small starter collection. They do not verify this item
        and are not added to your listing.
      </p>
      {notes.map((note) => (
        <article key={note.source.id}>
          <p>{note.text}</p>
          <p className="field-hint">{note.applicability}</p>
          <a className="text-link" href={note.source.url} target="_blank" rel="noreferrer">
            {note.source.publisher} · {note.source.title}
          </a>
          <p className="field-hint">{note.source.locator}</p>
        </article>
      ))}
    </details>
  );
}
