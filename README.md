# hsync

[![CI](https://github.com/monteslu/hsync/actions/workflows/ci.yml/badge.svg)](https://github.com/monteslu/hsync/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hsync.svg)](https://www.npmjs.com/package/hsync)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

**Any service can be exposed. Any service can connect. Any services can peer securely. And yes, it can all run in a browser too.**

hsync gives any service a public URL and peer-to-peer connectivity - whether it's running on a Raspberry Pi, your laptop, a cloud VM, or a browser tab.

## Quick Start

```bash
# Expose localhost:3000 to the internet
npx hsync -p 3000
```

You'll get a public URL like `https://a3k7m2p9.demo.hsync.tech` that forwards to your local server.

## Use Cases

| Scenario | Command |
|----------|---------|
| Expose local dev server | `hsync -p 3000` |
| Expose a database | `hsync -p 5432` |
| IoT device to internet | `hsync -s wss://your-server.com -hs your-secret -p 8080` |

## Browser Usage

hsync runs in browsers too. Your browser tab can be a server:

```html
<script src="https://unpkg.com/hsync/dist/hsync.min.js"></script>
<script src="https://unpkg.com/http-web/dist/http-web.js"></script>
```

```javascript
const con = await hsync.dynamicConnect();

const server = nodeHttpWeb.createServer((req, resp) => {
  resp.writeHead(200, { "Content-Type": "text/html" });
  resp.end("<h1>Hello from my browser!</h1>");
});
server.listen(3000);

console.log("Public URL:", con.webUrl);
```

## Programmatic Usage (Node.js)

```javascript
import { createConnection, dynamicConnect } from 'hsync';

// Quick dynamic connection (uses demo.hsync.tech)
const con = await dynamicConnect();
console.log('Public URL:', con.webUrl);
```

Or with explicit config:

```javascript
import { createConnection } from 'hsync';

const con = await createConnection({
  hsyncServer: 'wss://your-server.com',
  hsyncSecret: 'your-secret',
  port: 3000,
});
```

## How It Works

1. hsync connects to an hsync-server via MQTT over WebSocket
2. Server assigns you a public hostname
3. Incoming requests are forwarded to your service via MQTT
4. Optional: peers can connect directly via WebRTC

```
Your Service ◄─── hsync client ◄─── MQTT ◄─── hsync-server ◄─── Internet
                                       │
                              (or WebRTC for P2P)
```

## CLI Options

```
-p, --port <number>           Local port to expose (default: 3000)
-s, --hsync-server <url>      hsync-server URL (wss://...)
-hs, --hsync-secret <string>  Authentication secret
-d, --dynamic-host <url>      Get dynamic credentials from this host

Socket relay options:
-llp, --listener-local-port   Local port for TCP listener
-lth, --listener-target-host  Remote hsync host to connect to
-rip, --relay-inbound-port    Accept TCP connections on this port
-rth, --relay-target-host     Forward relay to this host
```

## Environment Variables

```bash
HSYNC_SERVER=wss://your-server.com
HSYNC_SECRET=your-secret
PORT=3000
```

## Development

```bash
npm install
npm test          # run tests (vitest)
npm run lint      # eslint
npm run format    # prettier
npm run build     # webpack browser bundle
```

## Self-Hosting

hsync requires an [hsync-server](https://github.com/monteslu/hsync-server). You can run your own or use the demo server at `demo.hsync.tech` for testing.

## Related Projects

- [hsync-server](https://github.com/monteslu/hsync-server) - The relay server
- [browserver-hsync](https://github.com/monteslu/browserver-hsync) - Browser-as-server demo

## License

ISC
