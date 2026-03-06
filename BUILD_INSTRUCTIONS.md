# Building RemoteConnect Agent EXE

## Option A — Build locally (5 minutes)

### Requirements
- Node.js 18+ → https://nodejs.org
- Windows 10/11 (for .exe) OR any OS for Mac/Linux builds

### Steps

```bash
# 1. Go into the desktop-agent folder
cd desktop-agent

# 2. Install dependencies
npm install

# 3. Build Windows portable EXE
npm run build:win

# Output: desktop-agent/dist/RemoteConnect Agent.exe
```

The `.exe` is fully portable — guests just download and run it. No installation needed.

---

## Option B — GitHub Actions (auto-build, recommended)

1. Push this entire project to a GitHub repository
2. Go to **Actions** tab in GitHub
3. Click **"Build RemoteConnect Agent EXE"** → **"Run workflow"**
4. After ~3 minutes, download the `.exe` from the **Artifacts** section

Every push to `main` will auto-build a new `.exe`.

---

## Option C — Host the EXE on your server

Once built, upload the `.exe` to:
```
/remoteconnect/agent/RemoteConnectAgent.exe
```

Then guests can download it directly from:
```
https://genusitsolution.com/remoteconnect/agent/RemoteConnectAgent.exe
```

The guest session page already has a download button for this.

---

## How the EXE works (for guests)

1. Guest double-clicks `RemoteConnectAgent.exe` — no install, just runs
2. A small window appears asking for the **session code**
3. Guest types the code given by the host (e.g. `A9A0C769`)
4. Clicks **Connect** — agent verifies with server
5. Guest also opens browser, joins session, clicks **Share Screen → Entire Screen**
6. When host clicks **Control** and guest clicks **Allow** in browser:
   - Agent starts executing ALL mouse/keyboard events at OS level
   - Host can now: right-click, open folders, type in Notepad, move files, everything
7. Agent shows live status — events being executed, RC active/inactive
8. When done, guest clicks **Disconnect** or closes the app to tray

---

## What makes this better than Python script

| Feature | Python Script | This EXE |
|---------|--------------|----------|
| Guest needs to install Python | ✅ Yes | ❌ No |
| Guest needs to run commands | ✅ Yes | ❌ No |
| Works on first click | ❌ No | ✅ Yes |
| System tray icon | ❌ No | ✅ Yes |
| Professional UI | ❌ No | ✅ Yes |
| Auto-start with Windows | ❌ No | ✅ (optional) |
| File size | ~5MB + deps | ~120MB standalone |
