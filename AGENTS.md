# Calendar maintenance

This repository is the canonical project for the user's Korean market calendar. Preserve the fixed public URL and update this repository instead of delivering repeated ZIP files.

## User-approved selection rules

- Core candidates: US CPI/PCE/payrolls/ISM/retail sales, Korean exports and rate decisions, major central-bank decisions/elections, big tech and representative large-cap reports, key market closures and index changes.
- Watch: other earnings, sector events, housing/regional indicators, revised/final estimates. No personal watchlist has been specified yet; watch entries are candidates, not claims about user holdings.
- Leave uncertain dates/names/time zones unconfirmed, even for core candidates. Default core view requires confirmed status.
- Do not bulk-add small-cap additional listings, routine disclosure reply deadlines, or unrelated events unless the user names the relevant holding/interest.

## Data and verification

- Edit data/calendar.json, keep stable IDs, bump revision, update updatedAt. Preserve past events and original-source history.
- Prefer official sources for confirmation. Store the supporting URL and meaningful verification notes. Do not mark source-transcribed events confirmed without checking dates.
- Convert known timed events to Asia/Seoul including DST. Specify local all-day/trading-day exceptions. Do not substitute call time for release time without labeling it.
- Keep priority (core/watch), status (confirmed/unconfirmed), reviewReason and archived distinct. Archive duplicate source records rather than silently dropping IDs.
- Run node scripts/sync-seed.cjs, node tests/store.test.cjs and node --check app.js after data/code changes. Verify UI for UI changes.

## Public vs private

- Never commit personal backup files, user holdings, credentials, private notes, or browser storage. Only the public catalog belongs in this repo.
- Browser edits and notes are private local overlays. Public updates must remain authoritative; never reintroduce loading the entire catalog from old localStorage snapshots.
- Tests must ensure public date changes become visible while private notes/custom events survive. Changing deployment or hosting must preserve the public project URL.
