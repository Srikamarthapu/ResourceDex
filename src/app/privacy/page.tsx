export default function PrivacyPage() {
  return (
    <article className="page-container prose">
      <p className="eyebrow">ResourceDex pilot</p>
      <h1 style={{ marginTop: 15 }}>A clear place for your data.</h1>
      <p>
        This is an implementation pilot. The information below explains the app’s current data flow.
        Complete retention and account-deletion operations must be validated before inviting
        external community members.
      </p>
      <h2>What stays private</h2>
      <p>
        Your authentication email, scan photos, unfinished drafts, requests, and pickup instructions
        are not public listings. Supabase stores accounts, records, and photos. Database and storage
        policies restrict private data to the relevant owner or participants.
      </p>
      <h2>What publication shares</h2>
      <p>
        Publishing shares the approved listing photo, reviewed resource details, your display name,
        a broad pickup area, and availability. Keep exact addresses, phone numbers, and personal
        details out of listing descriptions and photographs.
      </p>
      <h2>Optional photo assistance</h2>
      <p>
        Only after you choose “Identify items” and consent, the normalized photo is sent to Google
        Gemini. Suggestions can be wrong and require your review. You can choose manual entry
        without an AI request. The server removes image metadata and normalizes orientation before
        analysis.
      </p>
      <h2>Pickup details and photo links</h2>
      <p>
        Private meeting details are shared with the currently accepted requester. Cancellation
        closes their future access. Listing photo links expire after five minutes; a link already
        issued may work until expiry. Downloaded images cannot be recalled.
      </p>
      <h2>Storage and removal</h2>
      <p>
        Published and completed resources remain in owner history. Pilot targets are to remove
        abandoned scans after 30 days and completed or canceled pickup details after 30 days. These
        cleanup jobs are still a release gate. Until they are enabled and verified, retained pilot
        data must be removed by the project operator.
      </p>
      <p>
        Contact the organizer who invited you to the pilot for account or data deletion. A
        self-service account deletion flow is not available in this build.
      </p>
      <h2>Community guidelines</h2>
      <ul>
        <li>Offer only materials you own and are willing to give away for free.</li>
        <li>
          Describe visible damage and working condition honestly. Leave uncertain attributes
          unknown.
        </li>
        <li>
          Do not offer chemicals, hazardous waste, regulated items, or materials you know are unsafe
          to share.
        </li>
        <li>Do not share another person’s contact details or photos without permission.</li>
        <li>
          Report inaccurate, unavailable, inappropriate, or out-of-scope listings from their detail
          page.
        </li>
      </ul>
      <h2>About the sample photographs</h2>
      <p>
        Sample images are credited, licensed Unsplash photographs, used only for clearly labeled
        example listings. They are not evidence of actual community inventory. Full credits and
        licenses are included with the project source in docs/photo-credits.md.
      </p>
    </article>
  );
}
