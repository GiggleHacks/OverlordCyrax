# Multi-Webcam and Focused Viewer Design

## Dashboard

- The online display moves to the far-left edge of the toolbar and renders only a zero-padded monospace number.
- When the webcam filter is active, Select All selects every visible webcam-capable client. The bulk toolbar removes Disconnect, Uninstall, and Set Group and adds View Webcams.
- View Webcams shows a confirmation modal with the selected count, an animated six-cell tile preview, and a six-stream concurrency limit. Confirming opens a dedicated tiled viewer.

## Viewers

- The tiled viewer auto-starts up to six selected webcam streams using each user’s saved webcam settings. Each tile owns its stop control; selecting a tile stops other tile streams and opens the compact focused webcam window.
- Remote Desktop adopts the webcam focus treatment: no global branding/header, compact icon controls, auto-start, and saved 60%/100% workspace scale.
- A Desktop + Webcam action opens a two-pane viewer with independent start/stop controls and remote desktop on the left.

## Feedback and Safety

- Web Audio supplies brief, low-volume UI cues; Purgatory arrivals use a distinctive two-note sound. Sounds are enabled only after browser audio is unlocked by a user gesture and can be disabled through the user UI preferences.
- All stream pages retain existing feature-access checks and transport fallback behavior.

## Verification

- Add focused tests for bulk viewer input limits, branding/version defaults, and stream startup configuration.
- Run focused tests, JavaScript syntax checks, bundle build, and production HTTPS version/health checks.
