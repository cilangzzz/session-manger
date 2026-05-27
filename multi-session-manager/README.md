# Multi-Session Manager

A Chrome/Edge extension for managing multiple isolated sessions per tab, allowing you to log into multiple accounts on the same website simultaneously.

## Features

- **Tab-level Session Isolation**: Each tab can use a different session with its own cookies
- **Multiple Accounts**: Log into multiple accounts on the same website at the same time
- **Session Management**: Create, edit, delete, and switch between sessions easily
- **Visual Indicators**: Color-coded indicators show which session each tab is using
- **Context Menu**: Quick access via right-click menu
- **Data Export/Import**: Backup and restore your sessions

## Installation

### Development Mode

1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `multi-session-manager` folder
5. The extension icon should appear in your toolbar

### Generate Icons

Before loading the extension, you need to generate the icon PNG files:

1. Open `icons/generate-icons.html` in a browser
2. The icons will be automatically downloaded
3. Move the downloaded `icon16.png`, `icon48.png`, and `icon128.png` to the `icons/` folder

## Usage

### Basic Workflow

1. **Create a Session**: Click the extension icon, then click "+ New"
2. **Assign a Tab**: Select a session, then click "Assign Current Tab"
3. **Login**: The tab will reload with the new session - login to your account
4. **Multiple Accounts**: Open another tab, assign it to a different session, and login to another account

### Right-Click Menu

- Right-click on any page to access session options
- "Create New Session": Create a new session
- "Assign to Session": Assign current tab to a selected session
- "Open New Tab in [Session]": Open a new tab with a specific session

### Keyboard Shortcuts

- `Ctrl+Shift+S`: Create a new session
- `Ctrl+Shift+M`: Switch to next session for current tab

## Architecture

```
multi-session-manager/
├── manifest.json           # Extension configuration
├── background/
│   ├── index.js            # Service Worker entry
│   ├── core/
│   │   ├── TabSessionManager.js     # Core coordinator
│   │   ├── SessionStorageManager.js # Data persistence
│   │   └── CookieInjector.js        # Request interception
│   └── handlers/
│       ├── TabLifecycleHandler.js   # Tab events
│       └── ContextMenuHandler.js    # Right-click menu
├── popup/
│   ├── popup.html          # Popup UI
│   ├── popup.js            # Popup logic
│   └── popup.css           # Styles
├── options/
│   ├── options.html        # Settings page
│   └── options.js
├── lib/
│   └── utils.js            # Utility functions
└── icons/                  # Extension icons
```

## How It Works

### Cookie Isolation

1. **Request Interception**: When a tab makes a request, the extension intercepts it
2. **Cookie Injection**: The extension replaces the Cookie header with cookies from the tab's assigned session
3. **Response Capture**: Set-Cookie headers from responses are captured and stored in the session
4. **Browser Isolation**: The browser's native cookie store is used only for the "default" session

### Session Data

Each session stores:
- Unique ID, name, and color
- Cookies organized by domain
- Metadata (creation time, last used time)

## Technical Notes

### Manifest V3 Limitations

In Manifest V3, blocking `webRequest` is restricted for regular extensions. This extension uses the blocking mode for development. For production:

1. **Enterprise Deployment**: Use ExtensionInstallForcelist policy to enable blocking mode
2. **Alternative Approach**: Use `declarativeNetRequest` with `chrome.cookies` API (limited functionality)

### SameSite Cookies

The extension handles SameSite cookie restrictions:
- `Strict` cookies: Only sent in first-party context
- `Lax` cookies: Sent with top-level navigations
- `None` cookies: Can be sent cross-site (requires Secure)

## Troubleshooting

### Extension Not Working

1. Check that the extension is enabled in `chrome://extensions/`
2. Click the "Errors" button on the extension card for error details
3. Check the Service Worker console (click "Service worker" link)

### Cookies Not Isolating

1. Ensure the tab is assigned to a non-default session
2. Check that cookies are being captured (popup shows cookie count)
3. Some sites use localStorage/sessionStorage which may not be fully isolated

### Session Lost After Browser Restart

Sessions are persisted to `chrome.storage.local`. If they're lost:
1. Check storage quota in Settings
2. Export sessions periodically as backup

## Privacy

- All session data is stored locally on your device
- No data is sent to external servers
- Cookies are stored in Chrome's encrypted storage

## License

MIT License - feel free to use and modify as needed.