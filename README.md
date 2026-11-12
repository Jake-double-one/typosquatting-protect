# Domain Whitelist Protector

![Domain Whitelist Protector Logo](src/images/icon128.png)

A browser extension that protects against typosquatting and phishing by showing warnings for non-whitelisted domains.

## 🛡️ Features

- **Preemptive Domain Protection**: Get alerted before visiting non-whitelisted domains or blocked countries
- **Visual Warning Bar**: See a clear red warning banner on non-whitelisted websites
- **Flexible Configuration**: Choose to whitelist domains permanently or allow temporarily for a session
- **Import/Export Functionality**: Easily backup and transfer your whitelist between devices
- **Simple Management**: Add the current domain to your whitelist with a single click
- **Lookalike Detection**: Warns about domains that imitate whitelisted ones with characters from other alphabets (homograph attacks)
- **English and German**: The interface follows the browser language
- **Organization Whitelist**: Administrators can roll out a central whitelist and lock settings via Group Policy

## 📸 Screenshots

| Warning Bar                            | Confirmation Page                             | Country Blocked Page                     | Settings Panel                                |
| -------------------------------------- | --------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| ![Warning Bar](assets/warning-bar.png) | ![Confirmation Page](assets/confirmation.png) | ![Confirmation Page](assets/blocked.png) | ![Settings Panel](assets/settings-pannel.png) |

## 🔍 How It Works

1. **Domain Protection**: When you visit a website, the extension checks if the domain is in your whitelist
2. **Safe Navigation**: For non-whitelisted domains, the extension shows a confirmation page
3. **User Control**: You decide whether to continue, whitelist, or exit from the suspicious domain
4. **Session Allowance**: Choose to allow a domain just for the current session without adding it to your permanent whitelist

## 🚀 Installation

### Chrome Web Store

[![Chrome Web Store](assets/download-chrome.svg)](https://chrome.google.com/webstore/)

### Mozilla Add-ons

[![Firefox Add-ons](assets/download-firefox.svg)](https://addons.mozilla.org/en-US/firefox/addon/domain-whitelist-protector/)

## 🛠️ Manual Installation

Requires Chrome or Edge 153 or later.

### Chrome and Edge

1. Download this repository as a ZIP file and unpack it
2. Go to `chrome://extensions/` (Edge: `edge://extensions/`)
3. Enable "Developer mode"
4. Click "Load unpacked" and select the unpacked src/ directory

### Firefox

1. Download this repository as a ZIP file and unpack it
2. Rename `src/manifest.json` to `src/manifest.chrome.json`
3. Rename `src/manifest.firefox.json` to `src/manifest.json`
4. Go to `about:debugging#/runtime/this-firefox`
5. Click "Load Temporary Add-on"
6. Select any file in the unpacked src/ directory

## 🏢 Enterprise Rollout

The extension can be self-hosted, force-installed and configured through Group
Policy in Chrome and Edge. Administrators maintain a central whitelist (for
example `*.sharepoint.com`) that users cannot remove, and can optionally lock
the other settings.

```bash
node scripts/enterprise.js --url https://intranet.example.com/extensions --key key.pem
```

This creates the extension folder to pack, `update.xml`, and ADMX/ADML policy
templates in `dist/enterprise`. See the step-by-step guide (German):
[docs/enterprise-gpo.md](docs/enterprise-gpo.md).

Available policies (see `src/managed_schema.json`):

| Policy                   | Type            | Effect                                                    |
| ------------------------ | --------------- | --------------------------------------------------------- |
| `managedWhitelist`       | list of strings | Domains that are always whitelisted                       |
| `allowUserWhitelist`     | boolean         | `false`: users cannot whitelist their own domains         |
| `enablePreemptiveChecks` | boolean         | Forces the confirmation page on or off                    |
| `enableCountryBlock`     | boolean         | Forces country checks on or off                           |
| `noticeText`             | string          | Note shown to users on the confirmation page              |
| `geoProvider`            | string          | Lookup service: `ipwhois`, `geojs` or `ipapi`             |
| `blockedCountries`       | list of strings | ISO country codes that are always blocked                 |

## 🔒 Privacy

This extension:

- Does not collect any data about your browsing habits
- Stores your whitelist in your browser's sync storage, so it follows your browser profile if sync is turned on
- Looks up the country of **non-whitelisted** sites you open. By default the domain name is sent to Google Public DNS and the resulting IP address to ipwho.is, both over HTTPS. You can switch to geojs.io (HTTPS) or ip-api.com (plain HTTP) in the popup, or turn off "Country Checks" to stop all lookups
- Makes no other requests to remote servers

## 👨‍💻 For Developers

### Project Structure

```
domain-whitelist-protector/src/
├── manifest.json          # Extension configuration (Chrome, Edge)
├── manifest.firefox.json  # Extension configuration (Firefox)
├── managed_schema.json    # Settings administrators can set via policy
├── common.js              # Shared whitelist and settings logic
├── background.js          # Service worker: navigation checks
├── content.js             # Content script for warning bar
├── confirmation.html      # Safety confirmation page
├── confirmation.js        # Confirmation page logic
├── styles.css             # Warning bar styles
├── popup/                 # Settings UI
└── images/                # Extension icons
```

### Building from Source

```bash
# Clone the repository
git clone https://github.com/infnada/typosquatting-protect.git

# Navigate to the directory
cd typosquatting-protect

# Build the extension
node scripts/build.js build
```

`dist/chrome-extension.zip` is for both Chrome and Edge.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💡 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🙏 Acknowledgements

- Initial release of this extension was made 99% by claude.ai
- Everyone who has contributed to the project

---

<p align="center">
  Made with ❤️ for a safer browsing experience
</p>
