#!/usr/bin/env node
require('isomorphic-fetch');
const config = require('./config');
const { createHsync } = require('./connection');

async function start() {
  const resp = await fetch(config.dynUrl, {
    method: 'POST',
    body: '{}',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const result = await resp.json();
  const conConfig = {
    hsyncServer: `${config.dynWsProtocol}//${result.url}`,
    hsyncSecret: result.secret,
    hsyncBase: config.hsyncBase,
    port: config.port,
    keepalive: config.keepalive,
    localHost: config.localHost,
  };
  // console.log(result, config, conConfig);
  const hs = createHsync(conConfig);
  hs.on('connected', (con) => {
    console.log('\nlistenting to web requests on', `${config.dynProtocol}//${result.url}`);
    console.log('\nadmin', `${config.dynProtocol}//${result.url}/${conConfig.hsyncBase}/admin`);
    console.log('secret', result.secret);
  });
}

start();

