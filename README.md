# Slowly Letter Exporter

A browser extension that lets you export your Slowly letters as local backups. Supports Word, plain text, and Markdown — runs entirely in your browser with no data sent anywhere.

## ✨ Features

- **Export to Multiple Formats**: Save letters as:
  - 📄 Word Documents (.docx)
  - 📝 Plain Text (.txt)
  - ✍️ Markdown (.md)
  - 🗂️ HTML ZIP Archive

- **Privacy-First**: All processing happens locally in your browser — no data is sent to external servers
- **Batch Export**: Export multiple letters at once
- **Easy to Use**: Simple one-click interface
- **No Data Collection**: We don't track you or your letters

## 🚀 Installation

### For Users

#### Chrome/Edge/Brave (Chromium-based)

1. Download the latest release from [Releases](https://github.com/cheetoss-dev/slowly-letters-exporter/releases)
2. Extract the ZIP file to a folder
3. Open your browser and go to:
   - **Chrome/Edge**: `chrome://extensions/` or `edge://extensions/`
   - **Brave**: `brave://extensions/`
4. Enable **Developer mode** (toggle in top-right corner)
5. Click **Load unpacked** and select the extracted folder
6. The extension should now appear in your extensions list!

### For Developers

#### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

#### Setup

```bash
# Clone the repository
git clone https://github.com/cheetoss-dev/slowly-letters-exporter.git
cd slowly-letters-exporter

# Install dependencies
npm install

# Build the extension
npm run build

# The extension files will be in the dist/ folder
```

#### Development

```bash
# Run in development mode with hot reload
npm run dev

# Load dist/ folder as unpacked extension in your browser
```

## 📖 How to Use

1. **Open Slowly.app** in your browser
2. Click the **Slowly Letter Exporter** icon in your extensions menu
3. Choose your preferred export format:
   - **Word (.docx)** - Best for editing and sharing
   - **Markdown (.md)** - Best for version control and blogging
   - **Plain Text (.txt)** - Universal compatibility
   - **HTML ZIP** - Complete archive with formatting
4. Click **Export** and select where to save your file
5. Done! Your letters are now backed up locally

## 🔒 Privacy & Security

- ✅ **100% Client-Side**: All letter processing happens in your browser
- ✅ **No Tracking**: We don't collect any data or analytics
- ✅ **No Internet Requests**: The extension doesn't send your letters anywhere
- ✅ **Open Source**: You can inspect the code yourself

## 📋 Supported Browsers

- ✅ Google Chrome (v88+)
- ✅ Microsoft Edge (v88+)
- ✅ Brave Browser
- ✅ Other Chromium-based browsers

Firefox support coming soon!

## 🛠️ Development

### Project Structure

```
slowly-letters-exporter/
├── manifest.json          # Extension configuration
├── background.js          # Service worker
├── vite.config.js         # Build configuration
├── package.json           # Dependencies
├── src/
│   ├── content.js         # Content script
│   ├── popup/
│   │   └── popup.html     # Extension popup UI
│   ├── styles/            # CSS files
│   └── utils/             # Helper functions
└── dist/                  # Built extension (generated)
```

### Available Scripts

```bash
# Build the extension for production
npm run build

# Run development server with hot reload
npm run dev

# Preview the build
npm run preview
```

### Technologies Used

- **Vite** - Fast build tool
- **@crxjs/vite-plugin** - Chrome extension support for Vite
- **Manifest V3** - Modern Chrome extension standard

## 🐛 Reporting Issues

Found a bug? Have a feature request? [Open an issue](https://github.com/cheetoss-dev/slowly-letters-exporter/issues)!

Please include:
- Browser and version
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Screenshots (if applicable)

## 🤝 Contributing

We welcome contributions! 

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

For detailed contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md)

## 📝 License

This project is licensed under the MIT License — see [LICENSE](LICENSE) file for details.

## 📚 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

## ⭐ Show Your Support

If you find this extension helpful, please consider:
- ⭐ Starring this repository
- 🐛 Reporting bugs and suggesting features
- 🤝 Contributing to the project
- 📢 Sharing with others

## 🙋 Questions?

- Open an [issue](https://github.com/cheetoss-dev/slowly-letters-exporter/issues) for bug reports
- Start a [discussion](https://github.com/cheetoss-dev/slowly-letters-exporter/discussions) for questions
- Check existing [issues](https://github.com/cheetoss-dev/slowly-letters-exporter/issues) first

---

**Made with ❤️ for Slowly app users**
