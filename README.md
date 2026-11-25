# Dr. Pool staff app

Static site (GitHub Pages) for Dr. Pool staff. Sign in with your username and password.

- `index.html`: sign-in and app launcher
- `crm/`: team CRM (your tasks, the Office view, customers, jobs)
- `board/`: shared inbox Chalkboard (Office access)
- `tally/`: Chemical Tally, the SCP and Proline chemical invoices by route (Office access, see below)
- `shared/drpool.js`: Supabase connection and sign-in

Data lives in Supabase (the "brain") and is protected by row-level security. The key in `shared/drpool.js` is the public
"publishable" key, so it is safe to have in a public repo. No service key is used anywhere in this repo.

## Chemical Tally (`tally/`)

This is the full Chemical Tally, the same app as the "SCP Chemical Tally" Claude artifact, running on the staff site.
`tally/index.html` is the page, `tally/store.js` is the storage layer, `tally/phone.js` is the phone-order list, `tally/scans.js` is the invoice scans.

What it shows: the route table (with the Geffet and Stock rows), by day, by product, muriatic acid, the invoice list, the
vendor filter (SCP / Proline), invoice search (invoice, order and route numbers, tech names, order dates), price-change
alerts, backorder alerts with links to the invoice that delivered the item, and the Analytics tab (enlargeable graphs,
pool equivalents from the weekly schedule). It also keeps the shipped-quantity rule and the importer rules, because the
page logic is the same code as the Claude version.

### How it connects to the brain

| What | Supabase object | Who can read | Who can write |
| --- | --- | --- | --- |
| Invoices and lines (incl. `fulfilled_by`, `order_date`) | `supplier_invoices`, `supplier_invoice_lines` | Office access | Office access |
| Tech names, bottle price, aliases, price-alert acknowledgements, dismissed "missing item" alerts, route stop counts, saved weekly schedules, skipped-page notes | `tally_settings` (keys `config`, `alerts`, `missing`, `stops`, `schedules`, `skipped`) | Office access | Office access for those keys (insert/update, no delete); the owner for anything |
| Technician names per route | `technicians` | any signed-in staff | n/a |
| Weekly route schedule (pools, income, stops) | `v_route_summary` | any signed-in staff | n/a |
| Which week the brain is on | `brain_current_week()` | any signed-in staff | n/a |

Sign-in comes from `shared/drpool.js`. The page asks for Office access (`staff.office_access`); other staff are sent back
to the launcher. To give a coworker the Tally, set their `office_access` flag in the `staff` table.

### Claude-only features

The Claude artifact stays the data-entry tool. These need Claude (Ask Claude, PDF reading) and do not run on the staff site,
so they are hidden here:

- reading SCP / Proline invoice PDFs and screenshots
- phone-order chat entry (typing "route 6, 60 gallons of bleach...")

New invoices and phone orders are added in the Claude version and appear on the staff site from the shared database.
Everything else works here: lookups, alerts, analytics, CSV export, tech names, route stop counts, "taken from stock"
entries and loading a weekly schedule Excel.

PDF import was checked on purpose (Nov 2026): the Claude version does not parse PDFs with code. pdf.js only turns each page
into an image and Claude reads the image (no text extraction, no vendor rules in code), so there is nothing to port and the
staff page does not offer PDF import. Do not fake it with a new regex parser without Daniel's say-so.

Weekly schedule: weeks the Brain has show "from the brain" and are used automatically. A schedule Excel loaded here is kept in
`tally_settings` only ("saved here only"). It is not written to the Brain because `route_stops` is per stop with a customer link
and its write policy is `can_dispatch()` (Daniel and David only, not `can_office()`). Load the same Excel on the Brain page.

## Invoice scans (added 2026-11-25)
Each invoice can have a scanned picture, stored in Supabase Storage, private bucket `invoice-scans` (5 MB limit; JPG, PNG, PDF).
- Layout: `SCP/B7980083.jpg`, `Proline/4520395.jpg`; extra pages `SCP/B7980083_2.jpg`, `_3.jpg`. Name = invoice number exactly (case does not matter, `b7980083_2.jpg` also works).
- Who: Office users only (`can_office()`, same as the invoice tables) can see, upload, replace and delete. No anonymous access. Policies on `storage.objects`: `invoice_scans_office_select/insert/update/delete`, all `bucket_id = 'invoice-scans' AND can_office()`.
- Staff page (`tally/scans.js`, wired in `index.html`): Invoices tab has a Scan column (button opens the viewer through a 10-minute signed URL; Prev/Next for pages, zoom, Close) and a "Missing scans" filter. "Attach scans" in the top bar takes many files or one zip, shows a preview (new / already has a scan, replace? / no matching invoice), then uploads ticked rows with upsert. Images over 600 KB are compressed in the browser (JPEG, 1600 px, q0.75). Each invoice detail has Attach/Replace and Delete. The zip reader (JSZip) loads from jsdelivr only when a zip is chosen.
- No database column: the page lists the bucket folders (`SCP`, `Proline`) on each reload.
- The Claude artifact cannot reach Supabase Storage (its content policy blocks other hosts), so scans are viewed and managed on the staff page only. Do not add scan code to the artifact mirror.
