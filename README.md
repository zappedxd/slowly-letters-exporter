# Slowly Letter Exporter

This is a browser extension that lets you export your letters from the Slowly web app. It generates DOCX, TXT, or Markdown files so you can keep a local backup of your conversations.

## Features

- Export to Word (.docx), plain text (.txt), or Markdown (.md).
- Sort letters chronologically (oldest to newest or vice versa).
- Format DOCX files with continuous text or page breaks between letters.
- Everything runs locally in your browser. No data is sent to external servers.

## Installation

You will need to load this manually through Chrome's developer mode.

1. Download this repository as a ZIP file and extract it to a folder.
2. Go to `chrome://extensions/` in your browser.
3. Turn on "Developer mode" in the top right corner.
4. Click "Load unpacked" and select the folder you extracted.

## Usage

1. Log into Slowly Web and open a conversation thread.
2. Click the floating envelope button at the bottom right of the screen. (If you closed it previously, click the extension icon in your browser toolbar to bring it back).
3. Choose your export settings.
4. Click "Export Letters".

The extension will automatically scroll through the thread, compile the text, and download the file to your computer.

## Permissions

The extension uses a few standard permissions to work:
- `activeTab` and `scripting`: To read the text of the letters and navigate through the thread.
- `downloads`: To save the compiled file to your computer.
- `host_permissions` (`https://*.slowly.app/*`): To ensure the script only runs on the official Slowly website.

## Note

This is an unofficial tool and is not affiliated with SLOWLY Communications Ltd. Please use it responsibly and respect the privacy of the people you correspond with.
