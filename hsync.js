import net from 'net';
import dgram from 'dgram';
import mqtt from 'mqtt';
import createDebug from 'debug';
import { createHsync, setNet, setMqtt, setDgram } from './connection.js';
import config from './config.js';
import { setRTC } from './lib/peers.js';
import rtc from './lib/rtc-node.js';

const debugError = createDebug('errors');

setRTC(rtc);
setNet(net);
setDgram(dgram);
setMqtt(mqtt);

process.on('unhandledRejection', (reason, p) => {
  debugError(reason, 'Unhandled Rejection at Promise', p, reason.stack, p.stack);
});
process.on('uncaughtException', (err) => {
  debugError(err, 'Uncaught Exception thrown', err.stack);
});

async function dynamicConnect(configObj = {}) {
  const fullConfig = { ...config, ...configObj };

  fullConfig.dynamicHost = fullConfig.dynamicHost || fullConfig.defaultDynamicHost;
  const con = await createHsync(fullConfig);

  return con;
}

function createConnection(configObj = {}) {
  const fullConfig = { ...config, ...configObj };
  return createHsync(fullConfig);
}

export { createConnection, dynamicConnect, config };
