# Discord Archive Viewer

A private, read-only local viewer for Discord account data exports. It does not sign in to Discord, call Discord APIs, or upload archive contents.

## One-click start on Windows

Double-click **Start Discord Archive Viewer.cmd**. On the first run it prepares the app, then opens the viewer automatically. Keep the labeled window open while using the viewer; close it when finished.

Node.js 22 or newer is required. If Node.js is missing, the launcher shows where to get it.

## Run from a terminal

1. Install Node.js 22 or newer.
2. In this folder, run `npm install` once.
3. Run `npm run dev` and open the local address shown.
4. Choose the original Discord ZIP or its extracted root folder.

The app keeps imported files in the current browser tab's memory. Reloading the page clears the opened archive.

## Supported export shapes

- Discord-style `messages/<channel>/channel.json` folders with `messages.json` or `messages.csv`
- Account/user JSON for the archived display name
- Server and DM grouping from channel metadata
- JSON attachments, reactions, and embeds when present
- Local avatars and media files matched by exported path or filename
- A recovery mode for loose `messages.json` and `messages.csv` files

ZIP imports are checked for file count, expanded size, and suspicious compression ratio before extraction. ZIPs that expand beyond 2 GB must be extracted first, then opened with **Choose export folder**. Extracted folders are not subject to the ZIP memory limit because their files are read only as needed.
