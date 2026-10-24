# Argos

A Gemini-style AI assistant you can install on your phone. It's a Progressive Web App (installable, full-screen, works offline for the shell) with a tiny Node server that keeps your API key off the device.

## Features
- Gemini-like UI: greeting, suggestion chips, pill input bar, light/dark by system setting
- Streaming replies, stop button, markdown + code blocks
- Chat history drawer (stored on-device), voice input where the browser supports it

## Run
```bash
ANTHROPIC_API_KEY=sk-ant-... npm start   # no dependencies to install
```
Without a key it runs in demo mode. Optional env vars: `PORT` (3000), `ARGOS_MODEL` (`claude-sonnet-5-5`), `ARGOS_ACCESS_CODE` (require a code from the app – set this if the server is on the public internet).

## Put it on your phone
1. Deploy somewhere with HTTPS (Render, Fly.io, Railway, a VPS…) or expose your PC with a tunnel (`cloudflared tunnel --url http://localhost:3000`).
2. Open the URL on your phone. **Android/Chrome:** menu → *Install app*. **iPhone/Safari:** Share → *Add to Home Screen*.

## Taiwan storm tracker
Open `/storm` (or the 🌀 button in the app). It shows storm tracks, forecast path, wind radii, rain radar and live wind/rain for 12 Taiwan locations.
- **Official data:** set `CWA_API_KEY` (free at https://opendata.cwa.gov.tw) for Central Weather Administration typhoon analysis + forecast tracks.
- Without a key it falls back to GDACS (position/intensity only). Weather comes from Open-Meteo, radar from RainViewer. Nothing is estimated – missing values show "—".
