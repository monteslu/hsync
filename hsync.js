const net = require('net');
const mqtt = require('mqtt');
const debugError = require('debug')('errors');
const { createHsync, setNet, setMqtt } = require('./connection');
const config = require('./config');
const { setRTC } = require('./lib/peers');
const rtc = require('./lib/rtc-node');

setRTC(rtc);
setNet(net);
setMqtt(mqtt);

process.on('unhandledRejection', (reason, p) => {
  debugError(reason, 'Unhandled Rejection at Promise', p, reason.stack, p.stack);
});
process.on('uncaughtException', err => {
  debugError(err, 'Uncaught Exception thrown', err.stack);
});

async function dynamicConnect(configObj = {}) {
  const fullConfig = {...config, ...configObj};
  let con;

  fullConfig.dynamicHost = fullConfig.dynamicHost || fullConfig.defaultDynamicHost;
  con = await createHsync(fullConfig);

  return con;
}

function createConnection(configObj = {}) {
  const fullConfig = {...config, ...configObj};
  return createHsync(fullConfig);
}

module.exports = {
  createConnection,
  dynamicConnect,
  config,
};

