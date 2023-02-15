const net = require('net');
const mqtt = require('mqtt');
const { createHsync, setNet, setMqtt } = require('./connection');
const config = require('./config');
const { setRTC } = require('./lib/rtc');
const rtc = require('./lib/rtc-node');

setRTC(rtc);
setNet(net);
setMqtt(mqtt);

async function dynamicConnect(dynamicHost, configObj = {}) {
  const fullConfig = {...config, ...configObj};
  let con;

  fullConfig.dynamicHost = dynamicHost || fullConfig.defaultDynamicHost;
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

