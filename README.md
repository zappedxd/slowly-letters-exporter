# Slowly Letter Exporter

An unofficial browser extension to export your letters from [Slowly Web](https://web.slowly.app) as local backups.

---

## Features

- Export letters as **Word (.docx)**, **plain text (.txt)**, or **Markdown (.md)**
- Sort letters chronologically — oldest to newest, or newest to oldest
- DOCX layout options: continuous text or page breaks between letters
- Runs entirely in your browser — no data is sent anywhere

---

## Installation

This extension is loaded manually via Chrome's developer mode.

1. Download this repository as a ZIP and extract it
2. Go to `chrome://extensions/` in your browser
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `slowly-letters-exporter` folder

---

## Usage

1. Log into [Slowly Web](https://web.slowly.app) and open a conversation thread
2. Click the floating envelope button at the bottom-right of the screen
   > If you dismissed it, click the extension icon in your toolbar to bring it back
3. Choose your export format and settings
4. Click **Export Letters** — the extension will scroll through the thread and download your file

---

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab`, `scripting` | Reads letter text and navigates through the thread |
| `downloads` | Saves the exported file to your computer |
| `host_permissions` | Scoped to `https://*.slowly.app/*` only |

---

## Privacy

Everything runs locally in your browser. Your letters are never sent to any external server.

---

## Note

This is an unofficial tool and is not affiliated with SLOWLY Communications Ltd. Please use it responsibly and respect the privacy of the people you correspond with.
