# WP Image Scraper

A Chrome extension that detects whether the page you're on is built with
WordPress, then grabs every image on that page — `<img>` tags, `<picture>`
sources, common lazy-load attributes, and (optionally) CSS
`background-image`s — and bundles them into one neatly-named `.zip`.

No build step, no external services, no tracking. Everything runs locally
in your browser; images are fetched directly from the page's origin and
zipped client-side with [JSZip](https://stuk.github.io/jszip/).

## Features

- One-click WordPress detection (generator meta tag, `/wp-content/` /
  `/wp-includes/` resource paths, the `wp-json` REST API link tag, and the
  WP emoji script global).
- Finds images other scrapers miss: `srcset`, `<picture>`, lazy-load
  attributes (`data-src`, `data-lazy-src`, `data-original`), and CSS
  background images.
- Packages everything into a single zip with a predictable, parseable
  naming scheme (see below) — handy for scripting downstream processing.
- Ships a `manifest.csv` / `manifest.json` inside the zip so failed
  fetches (hotlink protection, 404s, etc.) are logged instead of silently
  dropped.
- No permissions beyond what's needed to read the active tab and save a
  file — no analytics, no remote calls.

## Installation

This extension isn't on the Chrome Web Store (yet) — install it from
source in developer mode:

1. Clone or download this repository.
   ```bash
   git clone https://github.com/P0werK00kie/Wordpress-Image-Downloader.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Toggle on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the `webimgscraper` folder you
   cloned/downloaded.
5. Pin the extension icon to your toolbar for quick access.

Chrome will warn that it's an unpacked/developer extension — that's
expected for anything installed outside the Web Store.

## Usage

1. Navigate to the page you want to pull images from.
2. Click the extension icon. It automatically scans the page and shows:
   - Whether WordPress was detected, and which signal tripped it.
   - How many images were found, and how many inline `data:` URIs were
     skipped.
3. Click **Download as ZIP**.
   - If the page wasn't detected as WordPress, check **"Scan anyway"**
     to enable the download button regardless — the extension works on
     any site, WordPress detection is just a heads-up, not a hard gate.
4. The zip lands in your normal Downloads folder.

Toggle **CSS background images** off if you only want content images
(`<img>`/`<picture>`), not decorative backgrounds.

## Output format

Zip filename: `wp-images_<domain>_<YYYYMMDD>-<HHMMSS>.zip`
e.g. `wp-images_example.com_20261108-143000.zip`

Inside the zip:

| Path | Description |
|---|---|
| `images/<seq>_<domain>_<name>.<ext>` | One file per successfully fetched image. `seq` is a zero-padded 4-digit index that matches the row number in `manifest.csv`. |
| `manifest.csv` | One row per *discovered* image (including failures): `index, status, saved_filename, original_url, alt_text, width, height, source, content_type, bytes`. |
| `manifest.json` | Page title, source URL, domain, scrape timestamp, and saved/failed counts. |

`status` is either `ok` or `failed: <reason>` — failed rows have no
corresponding file in `images/` but stay in the manifest so you can see
what was skipped and why.

## Known limitations

- Images behind hotlink protection, or that 403/404 on a direct fetch,
  are logged as `failed` rather than included — this doesn't block the
  rest of the zip.
- Lazy-loaded images that have never scrolled into view won't be in the
  DOM yet, so they won't be picked up. Scroll through the page once
  before scanning if a plugin lazy-loads on scroll.
- `data:` URI images (usually tiny placeholder/blur-up images) are
  skipped intentionally; the count is shown in the popup.
- This only reads what's rendered in the DOM at scan time — it doesn't
  crawl other pages or paginate.

## Contributing

Issues and PRs are welcome. The codebase is intentionally small and
dependency-free aside from the vendored copy of JSZip in `lib/`:

- `manifest.json` — extension manifest (Manifest V3).
- `popup.html` / `popup.css` / `popup.js` — toolbar popup UI and the
  in-page scanning/detection logic (injected via `chrome.scripting`).
- `background.js` — service worker that fetches images (bypassing CORS
  via `host_permissions`), builds the zip, and triggers the download.

## License

[MIT](LICENSE) — do whatever you'd like with it.
