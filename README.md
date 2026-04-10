# AikTube

**AikTube is a self-hosted, TweetDeck-style YouTube dashboard for people who are tired of YouTube's interface.**

Instead of an algorithmically curated feed full of distractions, AikTube gives you a clean set of vertical columns — one per topic — each showing only the latest videos from the channels you actually care about. You decide what goes where.

![AikTube screenshot](ScreenGrab%20(ita-version).png)

---

## What it does

- **Custom lists** — create named columns (Finance, Tech, Science, Design…) and assign any of your subscribed channels to them
- **Clean feed** — videos sorted by publish date, newest on top, no recommendations, no ads, no distractions
- **Time filters** — quickly filter all columns to show only videos from the last 1 day, 1 week, or 1 month
- **Inline player** — click any video to watch it inside AikTube; automatically falls back to YouTube if the channel has disabled embeds
- **Compact mode** — optionally collapse thumbnails to a small proportional size; hover to expand them
- **Channel avatars** — show channel icons on video cards for quick visual identification
- **Export / Import** — save your lists as a portable JSON file and load them on any machine or browser
- **Smart caching** — videos are cached for 30 minutes, subscriptions for 6 hours; a manual refresh button is always available

AikTube runs entirely on your own machine. There is no server, no account, no tracking. Your YouTube credentials stay on your computer.

---

## How it works (architecture)

AikTube is a single-page web app (`AikTube.html`) served by a small local Node.js server (`server.js`).

The local server does two things:
1. **Handles OAuth** — it manages the Google login flow server-side, so your access token is never exposed in the browser
2. **Proxies YouTube API calls** — all requests to the YouTube Data API v3 go through the server, which adds the access token automatically

The app talks to the local server; the server talks to Google. Nothing leaves your machine except YouTube API requests made on your behalf.

```
Browser (AikTube.html)
        ↕  localhost:51847
Local server (server.js)
        ↕  HTTPS
Google YouTube Data API v3
```

---

## Requirements

- **Node.js v18+** — [nodejs.org](https://nodejs.org)
- **A Google account** with YouTube subscriptions
- A browser (tested on Brave and Chrome)

No npm packages required — `server.js` uses only Node.js built-in modules.

---

## Quick start

### 1. Start the server

```bash
cd path/to/AikTube
node server.js
```

Open **http://localhost:51847** in your browser. Keep the terminal open while using the app.

You can also use the included launcher script, which starts the server in the background and opens the browser automatically:

```bash
chmod +x aiktube.sh   # make it executable (only needed once)
./aiktube.sh          # start server + open browser
./aiktube.sh stop     # stop the server
```

If the script opens the wrong browser, edit the `open -a "Brave Browser"` line in `aiktube.sh` and replace it with your browser's name (e.g. `"Google Chrome"`, `"Firefox"`).

To stop the server without the script:

```bash
kill $(lsof -ti :51847)
```

### 2. Set up Google OAuth (one time only)

AikTube needs access to your YouTube subscriptions. You'll create a free Google Cloud project and connect it to AikTube. This takes about 5 minutes and you only do it once.

#### Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Give it any name (e.g. `AikTube`) → **Create**

#### Step 2 — Enable the YouTube Data API

1. In the left menu → **APIs & Services** → **Library**
2. Search for `YouTube Data API v3`
3. Click it → **Enable**

#### Step 3 — Configure the OAuth consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - App name: `AikTube`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue** through all steps (leave scopes and test users blank for now)
5. On the final summary page, click **Back to Dashboard**
6. Click **Publish App** → **Confirm**

   > Publishing the app is necessary so that your own Google account can log in without being blocked by Google's unverified app warning. AikTube is not published to any app store — "publishing" here just means removing the test-mode restriction.

#### Step 4 — Create OAuth credentials

1. Left menu → **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: anything (e.g. `AikTube localhost`)
5. Under **Authorized redirect URIs**, click **+ Add URI** and enter exactly:
   ```
   http://localhost:51847/api/auth/callback
   ```
6. Click **Create**
7. A dialog appears with your **Client ID** and **Client Secret** — copy both

#### Step 5 — Connect AikTube

1. Open [http://localhost:51847](http://localhost:51847) in your browser
2. Paste the **Client ID** and **Client Secret** into the setup screen
3. Click **Save & Connect**
4. A Google login popup opens — sign in with your YouTube account and click **Allow**

That's it. AikTube will load your subscriptions and you can start building lists.

---

## API quota

AikTube uses the YouTube Data API v3 free tier, which gives you **10,000 units per day**. The quota resets at **midnight Pacific Time** (09:00 CET).

| Action | Units used |
|---|---|
| Load subscriptions (up to 500 channels) | ~1–10 units |
| Load videos for one channel | 3 units |
| Full refresh (↺) with N channels in lists | ~3×N units |

With a typical setup of 20–30 channels across your lists, a full refresh costs ~60–90 units — well within the free limit. Avoid pressing **↺ Refresh** repeatedly in quick succession.

---

## Your lists — saved as JSON

Your lists, channel assignments, and settings are saved in your browser's `localStorage`. To back them up or move them to another browser:

- Click **↓ Export** to download a `aiktube-YYYY-MM-DD.json` file
- Click **↑ Import** on any browser to restore them

---

## File structure

```
AikTube/
├── AikTube.html          — the entire frontend (single HTML file)
├── server.js             — local Node.js server: OAuth + YouTube API proxy
├── index.html            — redirect handler for OAuth callback
├── aiktube.sh            — optional launcher script
└── aiktube-config.json   — created automatically; stores your OAuth credentials
                            DO NOT share or commit this file
```

---

## Security

- The local server only accepts connections from `127.0.0.1` — it is not accessible from other machines on your network
- Your OAuth access token is stored server-side in `aiktube-config.json` and is never sent to the browser
- `aiktube-config.json` is blocked from being served as a static file
- If you use version control, add `aiktube-config.json` to your `.gitignore`

---

## Limitations

- AikTube only reads your subscriptions — it cannot like, comment, or post anything
- The YouTube embed player respects each channel's embed settings; if a channel has disabled embeds, AikTube will open the video on YouTube instead
- The free YouTube API quota is 10,000 units/day — more than enough for normal use, but repeated manual refreshes can deplete it
- There is no mobile app — AikTube is a desktop web app intended to run on your local machine
