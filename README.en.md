# Login Monitor

## Overview

`Login Monitor` is a local monitoring tool for checking whether a business web system is still logged in. It is designed for long-running use on an operations desktop or monitoring terminal.

The project contains two parts:

- A front-end dashboard for setting the target URL, opening a login browser, starting login-state monitoring, viewing logout records, and running network diagnostics
- A local back-end service built with `Express + Playwright` for persistent browser login, login-state checks, and diagnostic APIs

This app helps you quickly identify:

- Whether a page has logged out
- Whether the target page is being redirected
- Whether the target is reachable over the network
- Whether DNS, HTTPS, TCP, or routing conditions look abnormal

## Features

### 1. Login-State Monitoring

- Configure and save the target URL directly in the dashboard
- Open a visible browser window for manual login
- Persist login state with a Playwright user data directory
- Periodically check whether the target page appears to be logged out
- Support additional custom keywords for logout detection
- Update the status panel and record logout events in the log table

### 2. Logout Records

- Record logout time, status, page URL, and detail message
- Add a recovery entry when the page returns to normal
- Clear all records with one click

### 3. Network Diagnostics

The dashboard currently includes:

- `DNS` resolution
- `Ping` connectivity
- `HTTP` response overview
- `TCP` port connectivity
- `HTTP` timing analysis
- `HTTPS` certificate inspection
- Redirect chain analysis
- Repeated request sampling
- `Traceroute / Tracert` path analysis

The UI shows summarized results instead of full command echoes, which makes the dashboard easier to scan.

### 4. Cross-Platform Support

- macOS: fully supported
- Windows: login monitoring and most diagnostics are supported
- Linux: should work in principle, but is not specifically validated in this project

Platform notes:

- `Ping` uses OS-specific arguments automatically
- `Traceroute` uses `traceroute` on macOS/Linux and `tracert` on Windows
- `HTTP`, `TCP`, certificate, redirect, and sampling checks are mainly implemented with Node built-in modules for better cross-platform consistency

## Quick Start

### Requirements

Please make sure you have:

- [Node.js](https://nodejs.org/) 18 or later
- `npm`

Project dependencies:

- `express`
- `cors`
- `playwright`

Notes:

- `Playwright` requires a browser runtime to be installed before first use
- On Windows, `tracert` output may be incomplete depending on system policy or network rules

### Install Dependencies

From the project root:

```bash
npm install
```

Install the Playwright Chromium runtime:

```bash
npx playwright install chromium
```

### Start the Service

```bash
npm start
```

The server listens on:

```text
http://127.0.0.1:2333
```

### Open the Dashboard

Open the local page file in your browser:

```text
monitor.html
```

Recommended workflow:

1. Start the local service
2. Open `monitor.html`
3. Enter and save the target URL
4. Click `Open Browser Login` and complete a manual login once
5. Click `Start Monitoring`
6. Run `Network Diagnostics` when needed

## Project Structure

```text
login-monitor/
├── app-config.json   # Saved target URL configuration
├── monitor.html      # Front-end dashboard
├── server.js         # Local back-end service
├── user-data/        # Playwright persistent browser data
├── package.json      # Dependencies and scripts
└── bg.jpg            # Background image
```

## Configuration

### Target URL

The saved target URL is stored in:

```text
app-config.json
```

In normal usage, you do not need to edit this file manually. You can update it directly from the dashboard.

### Default Port

The server uses port:

```text
2333
```

If needed, update the `PORT` constant in [server.js](/Users/huhu/Documents/Develop/login-monitor/server.js).

## Notes

- Use the `Open Browser Login` action the first time so the login state is stored in the persistent browser profile
- Some environments block `ping` or `traceroute / tracert`; failed path checks do not always mean the target service is down
- If your target system uses a more complex SSO flow, add business-specific logout keywords to improve detection accuracy
- The built-in network diagnostics are intended for fast operational checks, not as a full replacement for dedicated troubleshooting tools

## Development

The project currently provides a minimal script set:

```bash
npm start
```

You can also run a syntax check with:

```bash
node --check server.js
```

## License

The current `package.json` declares the license as `ISC`.
