# PHC Smart Clinic acceptance testing

The feature lives inside the existing Doctor Dashboard at `/admin.html`. Use the `feature/phc-reference-library` branch and synthetic patients. The Smart Clinic endpoint requires a stamped Netlify dev, branch deploy or deploy-preview build, a non-production runtime, and the exact PHC Safety Test project URL.

## Preview setup

- Apply `supabase/migrations/20261125090000_smart_clinic.sql` once to PHC Safety Test. If the migration has already been applied, verify its two tables and save function in the database instead of rerunning the file.
- Configure only preview or local functions with `PHC_SMART_CLINIC_ENABLED=true`, `PHC_DASHBOARD_ENABLED=true`, `PHC_ENVIRONMENT=staging`, and `SUPABASE_URL=https://cefhdbqlzuxvnmktyxyk.supabase.co`. Use that project's server and Auth keys, stored as server environment variables. For local Netlify development run `CONTEXT=dev node scripts/stamp-deploy-context.cjs && node scripts/stage-pdf-reader.cjs` before starting Netlify Dev over HTTPS, then restore the tracked safe default after testing.
- Sign in with an existing authorized test doctor or provision a test Auth user through the Supabase dashboard and add its user ID to `phc_admin_accounts`. Keep Razorpay live credentials, live alerts and WhatsApp production credentials out of this environment.
- Run `npm ci` and `npm test` with Node 22.13 or newer.

## Repeatable browser smoke test

Install Playwright in a disposable checkout with `npm install --no-save --package-lock=false playwright` and download its Chromium build with `npx playwright install chromium`. Run `node scripts/stage-pdf-reader.cjs`, then `node scripts/smart-clinic-browser-smoke.cjs`. The script runs the actual dashboard UI against a loopback server with synthetic test data and exercises both desktop and 390 px layouts. Set `PHC_TEST_CHROMIUM_PATH` if you already have a compatible Chromium build. Hosted acceptance testing still uses PHC Safety Test.

## Acceptance checks

| Area | Check |
| --- | --- |
| Auth | Sign in and confirm the Reference library menu appears. Sign out and confirm it disappears and API access returns 401. |
| Library | Search for `Boger`, `रिपर्टरी` and `aushadhi`. Filter by category, open an edition, save a bookmark and note, then reload and check the saved state and reading history. Verify another authorized test doctor sees their own state. |
| Reader | Open two permitted local PDFs and jump to different pages. On a phone verify the panes stack and retain independent page controls. Search for a word in a PDF with embedded text. Close the reader and confirm the files must be selected again. |
| Consultations | Create a synthetic patient and manual visit or use a linked synthetic appointment. Confirm consent is required. Save a draft, reopen and review it, then edit the record as a draft to clear the previous review. Compare edits from two tabs to confirm stale saves fail. Verify follow-ups still appear in the original patient history. |
| Dictation | On a supported browser with a local language pack, obtain separate microphone consent and dictate synthetic Hindi and English text. Check the editable text before saving. Verify the manual entry fallback on unsupported devices. |
| PWA and theme | Test iPhone Safari, Android Chrome, a tablet and desktop. Install from browser controls or Add to Home Screen and check the dashboard after reopening. Toggle both themes. Disconnect the network and verify no patient data is served offline. |
| Regression | Run the existing booking and notification test suite. Verify that Smart Clinic rejects production and any Supabase URL other than PHC Safety Test. |

## Hindi scan and OCR

The supplied Hindi Boericke edition remains pending rights review. The catalogue links to online historical English editions and supplies Hindi catalogue labels. Local comparison accepts two PDFs the doctor is permitted to read.

For a cleared Hindi edition, verify the translator, publication details and rights for both the scanned edition and its text. Create a review JSON with `full_text_import_allowed: true`, a documented `rights_evidence` string, the PDF's `sha256`, and a `samples` object keyed by PDF page number. Use independently typed ground truth from at least three representative pages including any dense, tabular or degraded pages.

Run `python3 scripts/review-hindi-ocr.py edition.pdf review.json new-output-directory` with Poppler and the Tesseract `hin` and `eng` language packs. Read the per-page and weighted character error rates in `accuracy.json`. Review the output against the scan, including names, doses, and Devanagari vowel signs wherever present in the source. Sample scores alone cannot establish that unsampled pages are correct. Review the text before any publication or indexing. The script produces local draft text for the sampled pages only.

## Backup and recovery

Before production consideration, confirm Supabase backup retention and restore support for the clinic's plan. Agree on a maximum acceptable data loss window and restoration time with the clinic owner. Keep database backups encrypted, access-controlled, and out of Git and shared drives. Back up the patient, visit, consultation, audit and reference progress records together to preserve their foreign keys.

The automated suite rehearses a database snapshot restore in an isolated local PostgreSQL-compatible instance with synthetic records. Verify provider retention and perform a separate Supabase restore rehearsal before production.

Test restore in a separate controlled environment with synthetic data. Reapply compatible migrations and verify doctor access, visit links, consent and review metadata, bookmarks, and sample record counts. Document the backup timestamp, restore duration and verification results. Keep outbound payments and messaging disconnected while rehearsing. Review access controls before reopening any restored environment.
