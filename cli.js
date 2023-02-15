#!/usr/bin/env node

const { program, Option } = require('commander');
const pack = require('./package.json');
const config = require('./config');
const { createConnection } = require('./hsync');

program
  .name(pack.name)
  .description(pack.description)
  .version(pack.version)
  .addOption(new Option('-p, --port <number>', 'port for local webserver', 3000).env('PORT'))
  .addOption(new Option('-d, --dynamic-host <url>', 'host to get a dynamic connection from').env('HSYNC_DYNAMIC_HOST'))
  .addOption(new Option('-s, --hsync-server <url>', 'hsync-server location ex: wss://sub.mydomain.com').env('HSYNC_SERVER'))
  .addOption(new Option('-hs, --hsync-secret <url>', 'password to connect to hsync-server').env('HSYNC_SECRET'));

program.parse();

const options = program.opts();


if(options.port) {
  options.port = Number(options.port);
}

let [defaultCon] = config.connections;
defaultCon = {...defaultCon, ...options};

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
