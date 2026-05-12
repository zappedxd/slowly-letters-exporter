# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-12

### Added
- Initial release of Slowly Letter Exporter
- Export letters to multiple formats:
  - Word Documents (.docx)
  - Plain Text (.txt)
  - Markdown (.md)
  - HTML ZIP Archive
- Browser extension for Chrome, Edge, and Brave
- Privacy-first architecture (all processing client-side)
- Support for batch export of multiple letters
- Simple and intuitive user interface
- Manifest V3 support for modern Chrome extensions

### Features
- One-click export from Slowly.app
- Format selection UI
- Sanitized filename handling
- Blob URL management for large exports
- Service worker integration for downloads
- Content script injection for webpage integration

---

## Unreleased

### Planned
- [ ] Firefox support
- [ ] Safari support
- [ ] Enhanced UI/UX improvements
- [ ] Settings/preferences panel
- [ ] Export templates
- [ ] Advanced filtering options
- [ ] Bulk email export
- [ ] Cloud storage integration (optional)

### Under Investigation
- [ ] Performance optimization for large exports
- [ ] Internationalization (i18n) support
- [ ] Dark mode support

---

## Versioning Guide

- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality in a backwards compatible manner
- **PATCH** version for backwards compatible bug fixes

## How to Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues and pull requests.

## Security

If you discover a security vulnerability, please email us instead of using the issue tracker.

## Support

- 🐛 [Report a Bug](https://github.com/cheetoss-dev/slowly-letters-exporter/issues/new?template=bug_report.md)
- 💡 [Request a Feature](https://github.com/cheetoss-dev/slowly-letters-exporter/issues/new?template=feature_request.md)
- 💬 [Start a Discussion](https://github.com/cheetoss-dev/slowly-letters-exporter/discussions)
