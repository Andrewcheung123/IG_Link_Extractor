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

## Good to know

- Your Instagram sign-in is stored in a hidden `.ig-profile` folder created next to these files.
  Never share that folder.
- "Speech language" on Auto guesses from the caption. Pick the language yourself for Cantonese,
  or when the caption and the speech are in different languages.
- Save posts one at a time. Fetching in bulk can get an Instagram account flagged.
- Instagram can change its site at any time, which may break reading until the code is updated.
- For personal reference only; the posts belong to their authors.

Check the install: `node server.js test` should print `self-check ok`.
