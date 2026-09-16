---
name: keep-dev-server-running
description: Do not shut down the project dev server — the user views the application over the machine's internal network address
metadata:
  node_type: memory
  pinned: false
  originSessionId: a0fb31c4-6a97-4f4e-b585-7e433975a83c
  modified: 2026-09-03T10:39:24.018Z
---

The user views the running application not on their own machine but over the
internal address of the development server (for example `http://10.43.228.200:3000`
— the "Network" line in `next dev` output). They open it from a browser on another
device.

Therefore a running dev server must not be stopped: if I kill the process after my
own checks (`pkill -f "next dev"` and similar), the user simply loses access to the
application and has to ask what broke. When I need to switch branches or otherwise
disturb the running server, I must start it again afterwards and report the address
in the form `http://<Network address from next dev output>:3000` instead of leaving
the user without a working environment.

Separate workarounds (tunnels, deployments, publishing a static report) are
appropriate only as an addition, when the user explicitly asks to see the result
outside this server: their network access over the internal address is already
configured and working.
