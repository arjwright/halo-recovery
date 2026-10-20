# Halo Recovery

A standalone browser-based recovery and diagnostics tool for Brilliant Labs Halo glasses, based on the published Halo SDK and firmware protocol.

![screenshot of Halo Recovery](https://github.com/arjwright/halo-recovery/blob/c6d05f3521c5e35ecf7531847bf9e6f5a9a5774a/image0.jpeg)

## What it does

- Connects to Halo over Web Bluetooth.
- Sends recovery signals for a stuck device.
- Writes a recovery HUD or a simple static dashboard to main.lua.
- Provides display, sound, microphone, and camera diagnostics.
- Offers individual recovery commands, including removal or wiping of Lua files.

## Use

Serve this repository over HTTPS (or use localhost for development), open index.html in a supported browser, and connect the glasses. Web Bluetooth is supported in Chrome, Edge, and Opera on desktop and Android; it is not supported by iOS Safari.

Writing a HUD replaces main.lua on the glasses. Diagnostic tests may interrupt the current script. The Wipe action removes Lua files while preserving device settings; read the confirmation before proceeding.

The browser communicates directly with the connected device. This project does not send device data to a server.

### How to Use This

- Download all of the files of this repo onto a computer (that you have paired Halo to) or web server
- Open your web browser. This MUST be either Chrome or a Chromium-based browser. Safari/Safari Mobile does not work for this
- Open the index.html page in your browser
- Click the Connect button to bring up the menu to connect to your Halo (your Halo will have a ‘Halo ##’ name)
- Then click the buttons on the page to run the tests

### Notes

- There are no analytics whatsoever to this; everything happens in your browser ONLY
- The Camera Test takes an immediate shot of whatever you are looking at, and saves it only to your browser’s web storage (nothing goes to any cloud service)

## License

GPL-3.0. See LICENSE.
