const mqtt = require('precompiled-mqtt');
const buffer = require('buffer');
const net = require('net-web');
const { createHsync, setNet, setMqtt } = require('./connection');
const { setRTC } = require('./lib/peers');
const rtc = require('./lib/rtc-web');
const config = require('./config');


// TODO need to make this work with web/service workers
window.Buffer = buffer.Buffer;

setRTC(rtc);
setNet(net);
setMqtt(mqtt);

async function dynamicConnect(dynamicHost, useLocalStorage) {
  let con;
  if (useLocalStorage) {
    const localConfigStr = localStorage.getItem('hsyncConfig');
    if (localConfigStr) {
      const localConfig = JSON.parse(localConfigStr);
      if ((Date.now() - localConfig.created) < (localConfig.timeout * 0.66)) {
        config.hsyncSecret = localConfig.hsyncSecret;
        config.hsyncServer = localConfig.hsyncServer;
      } else {
        localStorage.removeItem('hsyncConfig');
      }
    }
  
    if (!config.hsyncSecret) {
      config.dynamicHost = dynamicHost || config.defaultDynamicHost;
    }
  
    con = await createHsync(config);
  
    if (config.dynamicHost) {
      const storeConfig = {
        hsyncSecret: con.hsyncSecret,
        hsyncServer: con.hsyncServer,
        timeout: con.dynamicTimeout,
        created: Date.now(),
      };
      localStorage.setItem('hsyncConfig', JSON.stringify(storeConfig));
    }

    return con;
  }

  config.dynamicHost = dynamicHost || config.defaultDynamicHost;
  con = await createHsync(config);

  return con;
  
}

function createConnection(configObj = {}) {
  const fullConfig = {...config, ...configObj};
  return createHsync(fullConfig);
}


const hsync = globalThis.hsync || {
  createConnection,
  dynamicConnect,
  net,
  config,
};
globalThis.hsync = hsync;

module.exports = hsync;
