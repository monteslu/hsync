const mqtt = require('precompiled-mqtt');
const buffer = require('buffer');
const net = require('./lib/web-net');
const { createHsync, setNet, setMqtt } = require('./connection');
const config = require('./config');

// TODO need to make this work with web/service workers
window.Buffer = buffer.Buffer;

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

module.exports = {
  createConnection: createHsync,
  dynamicConnect,
  net,
  config,
};
