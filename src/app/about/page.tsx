import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
export default function AboutPage() {
  return (
    <article className="page-container prose">
      <p className="eyebrow">Small exchanges. New beginnings.</p>
      <h1 style={{ marginTop: 15 }}>Good materials belong in use.</h1>
      <p>
        ResourceDex helps a community share spare materials, parts, and tools for free local pickup.
        A few offcuts or an unused hand tool might be the start of someone else’s project.
      </p>
      <h2>If you have something to share</h2>
      <ol>
        <li>Take a clear photo of your materials. Keep personal details out of the frame.</li>
        <li>
          Let photo identification suggest items, or add the details yourself. Review names,
          quantities, condition, and anything unknown.
        </li>
        <li>
          Choose a broad pickup area, review the public photo, and publish only when you’re ready.
        </li>
        <li>
          Review incoming requests, accept one person, and share pickup arrangements privately.
        </li>
      </ol>
      <h2>If you’re looking for something</h2>
      <ol>
        <li>Browse available resources and filter by category or pickup area.</li>
        <li>
          Read the owner’s description. Unknown material or condition should stay unknown until
          checked.
        </li>
        <li>
          Request the whole listing and suggest when you could pick it up. Your request is pending
          until the owner accepts.
        </li>
        <li>Agree on the private pickup details. The owner records the collection afterward.</li>
      </ol>
      <h2>Made for a small, thoughtful pilot</h2>
      <p>
        All exchanges are free and local. There are no payments, shipping, ratings, or partial
        reservations in this version. Ordinary solid materials are in scope; chemicals, hazardous
        waste, and regulated items are not.
      </p>
      <p>
        Sample listings are labeled on every card and detail page. Their photographs illustrate the
        app and don’t represent actual items available for pickup.
      </p>
      <div className="share-buttons">
        <Link href="/" className="button primary">
          Explore resources <ArrowRight size={15} />
        </Link>
        <Link href="/share" className="button">
          Share a resource
        </Link>
      </div>
    </article>
  );
}
