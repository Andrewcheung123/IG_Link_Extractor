# IG Link Console

Paste an Instagram link, and the post is saved into Apple Notes as a short note: a one-line summary
title, a few key points, a link back to the post, and the video or images. The summary is written from
the caption, the text inside images, and the speech in videos (English, Mandarin, Cantonese).
Everything runs on your own Mac. No API key, no account with anyone else.

## What you need

- A Mac with macOS 26 or newer (speech reading uses a feature added in macOS 26)
- Node.js 22 or newer — https://nodejs.org
- Google Chrome, in the Applications folder
- Apple's command line tools, for the one-time build below: run `xcode-select --install`
- For the summary and summary title: Apple Intelligence switched on (System Settings → Apple Intelligence & Siri).
  Without it, notes are still saved, titled with the author and first caption line.

## Set up (once)

Open Terminal in this folder and build the text/speech reader:

```bash
swiftc -O reader.swift -o reader
```

If you skip this, the console still works but does not read image text or speech.

## Use

```bash
node server.js
```

Then open http://127.0.0.1:3210 in any browser.

1. The first time you save, macOS asks whether to allow control of Notes. Click Allow.
2. Optional but recommended: press **Open sign-in browser**. A separate Chrome window opens.
   Sign in to Instagram there yourself and leave the window open. This unlocks private posts
   you can see, all images of a multi-image post, and videos.
3. Choose the Notes folder, paste a link, press **Save to Notes**.

Without signing in, only public posts work, with the caption and first image.

## Send links from your phone

1. On your phone, open https://my-project-ig-link-extractor.web.app, sign in with Google, and paste links there.
2. On the Mac, open the console at **http://localhost:3210** (not 127.0.0.1: Google sign-in only works on
   localhost) and press **Connect phone inbox** once, with the same Google account.
3. While that page stays open, links from your phone are saved to Notes one by one, into the folder and
   speech language chosen on the page. The phone page shows each link as saved or failed.

The console server starts at login and restarts if it stops, via `~/Library/LaunchAgents/local.ig-link-console.plist`
(log: `~/Library/Logs/ig-link-console.log`). If you move this folder, update the two paths in that file, then run
`launchctl bootout gui/$(id -u)/local.ig-link-console; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.ig-link-console.plist`.
Stop it for good with just the `bootout` part. While it runs, `node server.js` in Terminal fails (port 3210 already in use).

Links sent while the Mac is off wait until the page is open again. Failed links are not retried; send them again.
Deploy changes to the phone page or the database rules with `firebase deploy --only firestore:rules,hosting:ig`
(the rules file also holds the Todo List app's rules, so keep those in it).

## Good to know

- Your Instagram sign-in is stored in a hidden `.ig-profile` folder created next to these files.
  Never share that folder.
- "Speech language" on Auto guesses from the caption. Pick the language yourself for Cantonese,
  or when the caption and the speech are in different languages.
- Save posts one at a time. Fetching in bulk can get an Instagram account flagged.
- Instagram can change its site at any time, which may break reading until the code is updated.
- For personal reference only; the posts belong to their authors.

Check the install: `node server.js test` should print `self-check ok`.
