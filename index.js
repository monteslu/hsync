import config from './config.js';
import { createConnection } from './hsync.js';

const [defaultCon] = config.connections;
if (!defaultCon.hsyncServer && !defaultCon.dynamicHost) {
  defaultCon.dynamicHost = config.defaultDynamicHost;
}

config.connections.forEach((conConfig) => {
  createConnection(conConfig);
});
