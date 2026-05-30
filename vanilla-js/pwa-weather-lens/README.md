# 🔭 pwa-weather-lens

> **Track 1 — without-react-angular** · Vanilla JS PWA

Offline-capable weather dashboard built with pure HTML, CSS, and JavaScript.
No framework. No build step. Just the raw PWA primitives.

---

## PWA concepts covered

| Concept | File | What you'll learn |
|---|---|---|
| Web App Manifest | `manifest.json` | Install criteria, icons, display mode, shortcuts |
| Service Worker lifecycle | `sw.js` | install → activate → fetch events |
| Cache First strategy | `sw.js` | Static assets served instantly from cache |
| Network First strategy | `sw.js` | Fresh API data with offline fallback |
| Stale While Revalidate | `sw.js` | Fonts cached and updated in background |
| IndexedDB | `js/db.js` | Offline CRUD for cities and weather data |
| Install prompt | `js/app.js` | `beforeinstallprompt` + custom A2HS button |
| Offline indicator | `js/app.js` | `navigator.onLine` + online/offline events |
| Update flow | `js/app.js` | `updatefound` → waiting SW → SKIP_WAITING → reload |
| Background Sync | `sw.js` | Queue offline actions, replay on reconnect |
| Push Notifications | `sw.js` | `push` event + `showNotification` |

---

## Project structure

```
pwa-weather-lens/
├── index.html          ← App shell — links manifest, registers SW
├── offline.html        ← Shown by SW when fully offline (no cache)
├── manifest.json       ← PWA identity: name, icons, display, shortcuts
├── sw.js               ← Service Worker: caching strategies + push + sync
├── css/
│   └── style.css       ← Dark sky aesthetic, DM Mono + DM Sans
├── js/
│   ├── app.js          ← SW registration, install prompt, weather API
│   └── db.js           ← IndexedDB wrapper (favourites + weather cache)
└── icons/
    ├── icon.svg        ← Source icon — export to PNG at 192 and 512px
    ├── icon-192.png    ← Required for install prompt
    ├── icon-512.png    ← Required for splash screen
    └── icon-maskable-512.png ← For Android adaptive icons
```

---

## Step-by-step setup

### 1. Generate PNG icons from the SVG

```bash
# Using Inkscape (recommended)
inkscape icons/icon.svg --export-png=icons/icon-192.png --export-width=192
inkscape icons/icon.svg --export-png=icons/icon-512.png --export-width=512
inkscape icons/icon.svg --export-png=icons/icon-maskable-512.png --export-width=512

# Or use https://realfavicongenerator.net — upload icon.svg and download all sizes
```

### 2. Serve over HTTPS (PWA requirement)

Service Workers and the install prompt only work on **HTTPS** (or localhost).

```bash
# Option A — VS Code Live Server extension (simplest)
# Right-click index.html → Open with Live Server

# Option B — http-server with self-signed cert
npx http-server . --ssl --cert ~/.localhost-ssl/localhost.crt --key ~/.localhost-ssl/localhost.key

# Option C — Deploy to GitHub Pages (automatic HTTPS)
# Push to main branch, enable Pages in repo Settings → Pages
```

### 3. Test the PWA in Chrome DevTools

1. Open Chrome → DevTools (`F12`)
2. **Application tab** → Manifest → verify all fields loaded
3. **Application tab** → Service Workers → check "registered" status
4. **Application tab** → Cache Storage → see `weather-lens-static-v1`
5. **Lighthouse tab** → run PWA audit → aim for green checkmarks

### 4. Test offline mode

1. DevTools → Network tab → check "Offline"
2. Reload the page — should load from cache
3. Search should show "unavailable offline"
4. Previously viewed city weather should show from IndexedDB

---

## How the Service Worker works (key concepts)

### Cache versioning

```js
const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `weather-lens-static-${CACHE_VERSION}`;
```

**Why version caches?** When you deploy new files, the old cached files must
be deleted. By naming caches with a version, the `activate` event can delete
any cache whose name doesn't match the current version. Bump `CACHE_VERSION`
on every deploy.

### Three caching strategies

```
Cache First (static assets)
  Request → Cache hit? → Return cached
                  ↓ miss
              Fetch network → Store in cache → Return

Network First (API calls)
  Request → Fetch network → Store in cache → Return
                  ↓ fail
              Cache hit? → Check freshness → Return cached / offline JSON

Stale While Revalidate (fonts)
  Request → Return cache immediately
              + Fetch network in background → Update cache
```

### The install prompt flow

```
1. Browser checks: HTTPS? + manifest? + SW registered? + icons?
                          ↓ all yes
2. Browser fires `beforeinstallprompt` on window
3. app.js: event.preventDefault()    ← suppress browser default
4. app.js: deferredInstallPrompt = event  ← save the event
5. Show custom install button
6. User clicks → deferredInstallPrompt.prompt()
7. Browser shows native install dialog
8. Browser fires `appinstalled` → hide button
```

---

## APIs used

| API | URL | Key required |
|---|---|---|
| Open-Meteo Weather | `api.open-meteo.com/v1/forecast` | No |
| Open-Meteo Geocoding | `geocoding-api.open-meteo.com/v1/search` | No |

---

## Next steps

- [ ] Generate real PNG icons from `icon.svg`
- [ ] Deploy to GitHub Pages and verify Lighthouse PWA score ≥ 90
- [ ] Add VAPID keys and a push notification server
- [ ] Move to `pwa-notes-vault` → add IndexedDB CRUD + Background Sync

---

*Part of the [PWA Learning Path](../) — Track 1: without-react-angular*
