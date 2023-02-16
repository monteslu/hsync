const net = require('net');
const mqtt = require('mqtt');
const { createHsync, setNet, setMqtt } = require('./connection');
const config = require('./config');
const { setRTC } = require('./lib/peers');
const rtc = require('./lib/rtc-node');

setRTC(rtc);
setNet(net);
setMqtt(mqtt);

async function dynamicConnect(dynamicHost) {
  let con;

  config.dynamicHost = dynamicHost || config.defaultDynamicHost;
  con = await createHsync(config);

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

