# Cisco AP Scanner (Next.js + Vercel)

A production-ready, mobile-first Cisco access point field scanner built for iPhone Safari. It uses the **rear camera** for live barcode/QR scanning, parses Cisco label data in Full mode, stores scans in `localStorage`, exports CSV in-browser, and can email CSV securely via a server-side API route with Resend.

## What this app does

- Starts live scan from the phone camera (rear camera preferred).
- Continuously scans without requiring manual photo capture.
- Supports **Full** mode (parse PID/SN/MAC/MFG when possible) and **Light** mode (store raw only).
- Persists data locally (`localStorage`) for v1 (no DB).
- Exports CSV download.
- Emails CSV attachment via `POST /api/export-email`.

## Feature summary

- iPhone Safari-friendly camera flow (`playsInline`, rear camera preference).
- Camera status indicator: live / paused / error.
- Duplicate detection in Full mode by serial or MAC.
- Manual entry modal with optional overrides.
- Batch name support.
- Editable notes per device.
- Delete individual scans and clear all.
- Toast notifications.

## Tech stack

- Next.js (App Router) + TypeScript
- `@zxing/browser` for live scan decoding
- Resend for secure email sending from server route handlers
- Vercel-ready deployment

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create environment file:
   ```bash
   cp .env.local.example .env.local
   ```
3. Fill in values in `.env.local`.
4. Run dev server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000`.

## Required environment variables

Create `.env.local` with:

- `RESEND_API_KEY` – your Resend API key.
- `MAIL_FROM` – verified sender (e.g. `Field Scanner <scanner@yourdomain.com>`).

## Email export behavior

- Frontend prompts for destination email.
- Frontend sends `{ to, filename, csv }` to `/api/export-email`.
- Server route validates payload and env vars.
- Server sends short professional email with CSV attachment.
- API keys remain server-side only.

## GitHub setup steps

1. Create a new GitHub repository.
2. Copy this project into the repo root.
3. Commit and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Cisco AP scanner"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

## Vercel deployment steps

1. Import your GitHub repo in Vercel.
2. Keep default framework detection (Next.js).
3. Set environment variables in Vercel project settings:
   - `RESEND_API_KEY`
   - `MAIL_FROM`
4. Deploy.
5. Open your production URL from iPhone Safari over HTTPS.

## iPhone Safari camera notes

- Rear camera is requested using:
  ```ts
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  ```
- Video uses `playsInline` to avoid iOS fullscreen takeover.
- Camera access requires HTTPS in production.

## Troubleshooting camera access

If camera is blocked, users should check:

- iPhone: **Settings → Safari → Camera → Allow**
- Also ensure Screen Time restrictions are not blocking camera
- Confirm page is loaded over HTTPS
- Close and reopen Safari tab after changing permissions

## Data storage note (v1)

This version uses **only `localStorage`** and has **no backend database**. Data is tied to the device/browser profile and can be cleared by browser/site data cleanup.
