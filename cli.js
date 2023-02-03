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
  .addOption(new Option('-p, --hsync-password <url>', 'password to connect to hsync-server').env('HSYNC_SECRET'));

program.parse();

const options = program.opts();

console.log(options);

const [defaultCon] = config.connections;
if (!defaultCon.hsyncServer && !defaultCon.dynamicHost) {
  defaultCon.dynamicHost = config.defaultDynamicHost;
}

config.connections.forEach(async (conConfig) => {
  const con = await createConnection(conConfig);
  console.log('Listening for requests on: ', con.webUrl);
  console.log('Secret: ', con.hsyncSecret);
  console.log('Admin instance at: ', con.webAdmin);
});
