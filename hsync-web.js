import mqtt from 'mqtt';
import { Buffer } from 'buffer';
import net from 'net-web';
import { createHsync, setNet, setMqtt } from './connection.js';
import { setRTC } from './lib/peers.js';
import rtc from './lib/rtc-web.js';
import config from './config.js';

// TODO need to make this work with web/service workers
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}
globalThis.Buffer = Buffer;

setRTC(rtc);
setNet(net);
setMqtt(mqtt);

async function dynamicConnect(configObj = { useLocalStorage: true }) {
  const fullConfig = { ...config, ...configObj };
  fullConfig.dynamicHost = fullConfig.dynamicHost || fullConfig.defaultDynamicHost;
  if (fullConfig.net) {
    setNet(fullConfig.net);
  }
  let con;
  if (configObj.useLocalStorage) {
    const localConfigStr = localStorage.getItem('hsyncConfig');
    if (localConfigStr) {
      const localConfig = JSON.parse(localConfigStr);
      if (Date.now() - localConfig.created < localConfig.timeout * 0.66) {
        fullConfig.hsyncSecret = localConfig.hsyncSecret;
        fullConfig.hsyncServer = localConfig.hsyncServer;
      } else {
        localStorage.removeItem('hsyncConfig');
      }
    }

    con = await createHsync(fullConfig);

    if (!fullConfig.hsyncSecret) {
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

  con = await createHsync(fullConfig);

  return con;
}

function createConnection(configObj = {}) {
  const fullConfig = { ...config, ...configObj };
  return createHsync(fullConfig);
}

const hsync = globalThis.hsync || {
  createConnection,
  dynamicConnect,
  net,
  config,
};
globalThis.hsync = hsync;

export default hsync;
export { createConnection, dynamicConnect, config };
