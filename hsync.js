const net = require('net');
const mqtt = require('mqtt');
const { createHsync, setNet, setMqtt } = require('./connection');
const config = require('./config');

setNet(net);
setMqtt(mqtt);

async function dynamicConnect(dynamicHost) {
  let con;

  config.dynamicHost = dynamicHost || config.defaultDynamicHost;
  con = await createHsync(config);

  return con;
}

module.exports = {
  createConnection: createHsync,
  dynamicConnect,
  config,
};
