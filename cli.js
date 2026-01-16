#!/usr/bin/env node

import { program, Option } from 'commander';
import { createRequire } from 'module';
import config from './config.js';
import { createConnection } from './hsync.js';
import shell from './shell.js';

// For JSON imports (package.json)
const require = createRequire(import.meta.url);
const pack = require('./package.json');

program
  .name(pack.name)
  .description(pack.description)
  .version(pack.version)
  .addOption(new Option('-p, --port <number>', 'port for local webserver', 3000).env('PORT'))
  .addOption(
    new Option('-d, --dynamic-host <url>', 'host to get a dynamic connection from').env(
      'HSYNC_DYNAMIC_HOST'
    )
  )
  .addOption(
    new Option('-s, --hsync-server <url>', 'hsync-server location ex: wss://sub.mydomain.com').env(
      'HSYNC_SERVER'
    )
  )
  .addOption(
    new Option('-S, --hsync-secret <string>', 'password to connect to hsync-server').env(
      'HSYNC_SECRET'
    )
  )
  .addOption(
    new Option('-L, --listener-local-port <number>', 'local port to open for listener').env(
      'HSYNC_LLP'
    )
  )
  .addOption(
    new Option('-H, --listener-target-host <url>', 'target host for listener').env('HSYNC_LTH')
  )
  .addOption(
    new Option('-T, --listener-target-port <number>', 'target port for listener').env('HSYNC_LTP')
  )
  .addOption(
    new Option('-R, --relay-inbound-port <number>', 'inbound port for remote relay requests').env(
      'HSYNC_RIP'
    )
  )
  .addOption(
    new Option(
      '-t, --relay-target-host <url>',
      'target host for relay to open tcp connection on'
    ).env('HSYNC_RTH')
  )
  .addOption(
    new Option(
      '-P, --relay-target-port <number>',
      'target port for relay to open tcp connection on'
    ).env('HSYNC_RTP')
  )
  .addOption(
    new Option(
      '-w, --relay-whitelist <string>',
      'whitelist of domains that can access this relay'
    ).env('HSYNC_RWL')
  )
  .addOption(
    new Option(
      '-b, --relay-blacklist <string>',
      'blacklist of domains that should be blocked from this relay'
    ).env('HSYNC_RBL')
  )
  .addOption(
    new Option('-x, --shell', 'shell to localhost and --port for piping data to a listener')
  );

program.parse();

const options = program.opts();

if (options.port) {
  options.port = Number(options.port);
}

if (options.shell) {
  shell(options.port);
} else {
  if (options.listenerLocalPort) {
    options.listenerLocalPort = options.listenerLocalPort.split(',').map((p) => Number(p));
  }
  if (options.listenerTargetHost) {
    options.listenerTargetHost = options.listenerTargetHost.split(',');
  }
  if (options.listenerTargetPort) {
    options.listenerTargetPort = options.listenerTargetPort.split(',').map((p) => Number(p));
  }

  if (options.relayInboundPort) {
    options.relayInboundPort = options.relayInboundPort.split(',').map((p) => Number(p));
  }
  if (options.relayTargetHost) {
    options.relayTargetHost = options.relayTargetHost.split(',');
  }
  if (options.relayTargetPort) {
    options.relayTargetPort = options.relayTargetPort.split(',').map((p) => Number(p));
  }

  // console.log('options', options);

  let [defaultCon] = config.connections;
  defaultCon = { ...defaultCon, ...options };

  if (!defaultCon.hsyncServer && !defaultCon.dynamicHost) {
    defaultCon.dynamicHost = config.defaultDynamicHost;
  }

  config.connections[0] = defaultCon;

  config.connections.forEach(async (conConfig) => {
    const con = await createConnection(conConfig);
    console.log();
    console.log('Listening for requests on: ', con.webUrl);
    console.log('And forwarding to: ', 'http://localhost:' + con.port);
    console.log();
    console.log('Admin ui at: ', con.webAdmin);
    console.log('Secret: ', con.hsyncSecret);
    console.log();
  });
}
