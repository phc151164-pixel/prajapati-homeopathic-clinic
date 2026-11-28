# PHC reference library

Development only. Do not deploy to production until authorization and tests are complete.

## Scope
- Historical educational reference catalog, Hindi and English metadata and search.
- Source edition, author, publication date, provenance, rights status and translation review for every imported text.
- Only verified public-domain or licensed editions. No automated treatment selection, remedy ranking, dosage or diagnosis.
- Doctor-only authorization enforced server-side using existing verified admin role; do not rely on hiding navigation.
- Personal bookmarks scoped to authenticated owner; no patient data in library search or logs.
- Test using PHC Safety Test with synthetic data only. Do not copy production records.

## Acceptance tests
- Anonymous and non-doctor requests denied; authorized clinician can search permitted references.
- Hindi and English title search; mobile-friendly reading and bookmarks.
- Unverified editions are not published; source citations visible.
- Existing booking, payment, and notification flows unchanged.

## Candidate catalog (rights not yet verified)
- J. T. Kent, Repertory of the Homoeopathic Materia Medica.
- William Boericke, Pocket Manual of Homoeopathic Materia Medica.
- Samuel Hahnemann, Organon of Medicine.
- Hindi translations: verify edition rights or commission original reviewed translations of public-domain originals.
