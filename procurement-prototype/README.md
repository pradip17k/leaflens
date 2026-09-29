# ProcureFlow — procurement scheduling prototype

A standalone, configurable software mini-project inspired by SIH26032: farmer procurement schedules, waiting times and status. This folder is independent of the LeafLens application; no changes to the LeafLens website are required.

## Run locally

Requires Node.js 18 or newer. No installation or API key is needed.

```sh
cd procurement-prototype
npm start
```

Open **http://127.0.0.1:4174**. Stop the server with Ctrl+C.

## What works

- Overview with hourly capacity utilisation, queue counts and accepted quantity.
- Farmer bookings checked against both delivery-count and quantity limits.
- Booking tokens and downloadable text receipts.
- Current-day check-in, first-checked-in processing, quality checks, weighing and completion.
- Actual accepted weight, holds with reasons, non-acceptance, cancellations and no-shows.
- Parallel processing lanes and illustrative waiting-time ranges.
- Centre pauses and a manually controlled demo clock.
- Configurable centre name, crop, operating hours, hourly limits, processing rate and lanes.
- Search, status filters and CSV export.
- Browser-local persistence and resettable sample data.
- Saved-session validation, stale-tab write protection, and downloadable JSON backups.
- Next-day progression that preserves historical and future bookings.

## Demo walkthrough

1. Start on Overview. The demo begins at 10:00 with eight fictional bookings.
2. Book a delivery for 11:00 or later with a quantity that fits the displayed remaining capacity. Download its receipt.
3. Open Operations. Finish the sample delivery already in Weighing to free a lane.
4. Start the first checked-in farmer. Move from Quality check to Weighing, then record actual weight and complete procurement.
5. Advance the demo clock until 30 minutes before a new booking to enable check-in.
6. Pause the centre to see waiting estimates change. Resume it, or advance the clock beyond the pause.
7. Change the crop or service rate in Centre settings. Bookings retain their original crop; new bookings use the new crop.
8. Export the booking table or reset the sample day.

## Rules and assumptions

- Arrival windows are one hour. No bookings are accepted for a window that already started on the demo date.
- Check-in opens 30 minutes before a delivery's window, and only during working hours. Late arrivals may check in and join by actual arrival time.
- Processing is first checked in, first served, with queue-entry order breaking timestamp ties. Older saved sessions use token order for ties until deliveries rejoin the queue.
- Service estimate = ceiling(fixed minutes + estimated kg / processing kg per minute).
- Waiting estimates assign checked-in farmers to the next estimated available lane. Active jobs remain busy until an operator changes their state; overdue jobs are assumed to require at least five more minutes.
- The displayed upper wait bound adds ten illustrative minutes. It is not a calibrated prediction interval.
- Pausing prevents new processing; active jobs are not automatically completed or moved.
- Cancelled bookings and no-shows release their window capacity. Completed and rejected deliveries remain part of the reserved workload for that window.
- A held delivery releases its processing lane but retains reserved booking capacity. Resuming puts it at the back of the waiting queue.
- Capacity or operating-hour changes that conflict with existing reservations are rejected. Busy lanes cannot be removed.
- No-show status becomes available after the booked hour ends.
- **Start next day** in Centre settings advances the calendar to the next day at opening time. Resolve outstanding deliveries first; history and future bookings are preserved.

## Storage and limitations

This is a **local single-browser demonstration**, not a production procurement service. It has no real accounts, server-side authorisation, shared database, notifications, payments, identity checks or government integrations. Any person using the page can access the operator controls.

State is stored in localStorage under `procureflow-prototype-v1`. Do not enter sensitive information. Browser storage can be cleared; exports are the user's responsibility. A tab checks its saved snapshot before writing and refuses to overwrite changes from another tab. This is not transactional locking; simultaneous writes and multiple devices still require a server database. Use one tab for a demo.

Damaged saved data is preserved, with writes blocked until an explicit reset. Use **Download backup** in Centre settings to keep the original saved JSON before resetting. Backups are archival downloads; an in-app restore flow is not yet available. Failed saves roll the displayed session state back to the last successful save and show a persistent warning.

The demo date starts at the local calendar date on first load or reset. An existing saved session retains its original demo date. The clock does not advance automatically. No operational improvement is claimed without field testing.

## Tests

```sh
npm test
```

Tests cover booking capacity, cancellation, date and quantity validation, lane limits, pauses, lifecycle transitions, queue estimates, exceptions, no-shows, settings bounds, same-minute queue re-entry, next-day progression, saved-data validation and stale-tab conflicts.

## Structure

- `public/domain.mjs`: booking rules and queue estimates, independent of the UI
- `public/app.mjs`: screens, state, forms and dialogs
- `public/style.css`: responsive presentation
- `public/index.html`: application shell
- `server.cjs`: local static server on port 4174
- `tests/domain.test.mjs`: domain logic tests

## Production extension

Replace localStorage with an API and database. Enforce all rules server-side, atomically reserve capacity, add authenticated farmer/operator roles, audit state transitions and validate estimates with actual centre service data. This prototype's role screens are not security boundaries.
