# Changelog

## 2.0.0 (unreleased)

All changes below were tested in desktop Chromium (Playwright with a fake camera) and Node. None of it has been tested on a real iPhone yet; see `docs/device-test-checklist.md`.

### Phase 0: foundations
- The app is now ES modules under `site/src/`, with no build step.
- zxing-wasm 2.2.4 (reader build) is vendored and pinned, and the wasm SHA-256 is recorded.
- Tests:
  - Node unit tests
  - golden-image tests on synthetic label photos
  - Playwright end-to-end tests on Chromium in an iPhone 13 viewport
- GitHub Actions CI runs every test and publishes `site/` to Pages from `main`.
- MIT license.

### Phase 1: live scan speed
- Decoding runs in a Web Worker. Frames are handed over as `VideoFrame` or `ImageBitmap` transfers. Measured on the AP fake-camera feed: no main-thread long tasks over 50 ms.
- Decoding uses a native-resolution crop of the on-screen guide, not a scaled-down frame.
- Cheap decode every frame. A sharpness gate (Laplacian variance) decides when to run the expensive region and tilt sweep, and only on the sharpest recent frame. A region cache re-reads a known barcode at the angle and scale that worked last time.
- Barcodes are outlined on the preview. A field confirms when two reads agree.
- `BarcodeDetector` is used as an accelerator where the browser has it. zxing-wasm always runs.
- Measured in CI and locally (synthetic 1080p feeds):
  - AP feed: all four codes read in about 0.7–1.0 s, all confirmed in about 0.9–1.2 s
  - switch feed: every field read and confirmed in under 0.5 s

### Phase 2: data quality
- Per-field confidence: confirmed (green), read once (amber), typed (grey).
- Checks:
  - serial date codes (site and manufacturing year and week)
  - MAC OUI against the IEEE Cisco/Meraki list (bundled)
  - hardware revision split out of the PID
  - Cisco serial vs. Meraki serial mismatch warning
- A scan that matches a saved device asks **Open existing** or **Add as new**.
- **Scan asset tag**: a single-code live mode for an asset tag on another face of the device.
- Delete and merge, both with undo.

### Phase 3: files and storage
- Files are stored in IndexedDB, with a synchronous localStorage journal so a reload right after an edit loses nothing. Older localStorage data is migrated once.
- Location and Rack/U per file.
- **Auto-save in live scan** setting, off by default.
- Progress line and an *Incomplete* / *Duplicates* filter.
- **Delete all data**.

### Phase 4: export
- Templates: the two original CSV layouts (unchanged), a Snipe-IT import preset, and custom templates (pick, order and rename columns).
- JSON export of a whole file for scripting.
- File names follow `label-scan_<file>_<YYYY-MM-DD>.<ext>`.
- CSV formula-injection guard kept.

### Phase 5: app shell
- Installable PWA:
  - manifest and icons
  - service worker that precaches the whole app, so it opens and scans offline
  - **Update ready** bar for new versions
- Light, dark and system theme. Fonts self-hosted, no third-party requests.
- Screen-reader announcements for live reads. axe WCAG 2.1 AA clean in both themes. 44 px tap targets, no horizontal scroll at 360 px.
- iOS home-screen camera hint and an install tip.
- **Scan quality tips** sheet.
- Quiet *Not exported yet* chip. Export stays behind **Finish and export**.
- Fix: a photo picked while the previous one was still being read was dropped. It is now queued.

### Phase 6: docs
- README covering setup, privacy, supported labels and known limits, with screenshots.
- This changelog.
- Version shown in the footer.
- `docs/device-test-checklist.md`.
