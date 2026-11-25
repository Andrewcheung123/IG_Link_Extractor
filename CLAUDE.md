# IG Link Console: notes for Claude

Read README.md first; it covers the features and how to use them. This file holds what the README does not.

## How it fits together
- `server.js`: the Mac console at http://localhost:3210. It reads a post, downloads its media, then runs `reader`, then
  saves to Apple Notes through `osascript`. All the console's HTML is a string inside `server.js`.
  `node server.js test` runs the self-checks.
- `reader.swift` → `reader`: on-device OCR, speech-to-text (en-US, zh-TW, zh-HK) and summaries (Apple Intelligence).
- Signed-in reading: a separate Chrome on debugging port 9333, with its profile in `.ig-profile/`. The console calls
  Instagram's API from inside that tab. Without it, only the public embed page works (caption and first image, no video).
- Phone inbox: `public/` is deployed to Firebase Hosting (https://my-project-ig-link-extractor.web.app). The phone adds
  docs to `inbox/{uid}/links` in Firestore. The server polls that queue every 20 s over Firestore REST as the user
  (`pollInbox` in `server.js`), using a Firebase refresh token that the console page POSTs once to `/inbox-token`.
  The token is stored in `.ig-profile/inbox-token.json` (mode 600, never in git or backups). No page needs to stay open.
  The Firebase project is `my-project-a3cb8`, shared with the user's Todo List app: keep the `lists` rules in `firestore.rules`.
- Auto-start: `~/Library/LaunchAgents/local.ig-link-console.plist` (KeepAlive, log `~/Library/Logs/ig-link-console.log`).
  A copy sits in `launchagent/` in the backup zip.

## Gotchas learned so far
- Failed links are not retried; the user has to send them again. A link stays "Saving…" for good if the server dies
  mid-save (the rules forbid putting it back to `queued`).
- After editing `server.js`, run `launchctl kickstart -k gui/$(id -u)/local.ig-link-console`, or the old code keeps running.
- The launch agent holds absolute paths. When the project folder moved, it failed silently (13k+ restarts).
- While the launch agent runs, the `ig-console` preview in `.claude/launch.json` and `node server.js` fail
  (port 3210 is in use).
- Saving in bulk (for example the 41 GTA6 reels, 2026-11-24): POST to `/extract` with header `Origin: http://localhost:3210`,
  one at a time, about 30 s apart, so the Instagram account is not flagged. The Notes folder id comes from `/folders`.
- Google sign-in on the console only works at `localhost`, not `127.0.0.1`.

## Moving to a new Mac (do this once, then delete this section)
1. Put the project at `~/Desktop/IG_Extractor`, or edit the two paths in `launchagent/local.ig-link-console.plist`.
2. Check: `node -v` (22+), Google Chrome in /Applications, macOS 26+, `xcode-select --install`.
3. `swiftc -O reader.swift -o reader`, then `node server.js test` should print `self-check ok`.
4. `cp launchagent/local.ig-link-console.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.ig-link-console.plist`
5. The user (not Claude) opens http://localhost:3210, allows Notes access, presses **Open sign-in browser** and signs in
   to Instagram, then presses **Connect phone inbox** and signs in with Google. `.ig-profile` is not in the backup.
6. Only to redeploy: `npm i -g firebase-tools`, `firebase login` (the user does this), then
   `firebase deploy --only firestore:rules,hosting:ig`.
