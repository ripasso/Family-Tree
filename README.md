# Family Tree

A small, self-hosted family tree app. People are circles connected by lines —
lines going down are parent/child links, horizontal lines are spouse links
(so a childless marriage still shows up). Click a person to see or edit their
birth/death year and any memories, or to add a spouse/child/parent.

No accounts, no moderation — built for trusted, good-faith editing within one
family. Multiple people can edit at the same time from different locations;
changes merge live using a CRDT (a data structure built for this — see the
comments in `public/app.js` for more on how that works).

## Running it locally

1. Install the sync server's dependencies:
   ```
   npm install
   ```
2. Start the sync server (keeps everyone's edits merged and saved to disk):
   ```
   npm run start-server
   ```
3. In another terminal, serve the frontend files over http (not by opening
   the HTML file directly — browsers block the kind of imports this app uses
   when opened as a bare file):
   ```
   npm run serve
   ```
   This prints a local URL (usually `http://localhost:3000`) — open it in
   your browser. Open it in a second tab too, to see live sync in action.

## Making it reachable by family in other locations

Right now `SERVER_URL` in `public/app.js` points at `ws://localhost:1234`,
so only browser tabs on your own machine can sync. To make it usable by
family elsewhere, deploy the sync server (`npm run start-server`) to any
always-on host (e.g. a small VPS, Fly.io, Render) and update `SERVER_URL` to
point at it — that's the only code change needed.

## Data

Each person is stored as one record with a name, birth year, death year, a
free-text comment, up to two parent ids, and any number of spouse ids. The
sync server saves everything to the `data/` folder (via `YPERSISTENCE`) so
the tree survives a restart.
