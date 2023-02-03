const config = require('./config');
const { createConnection } = require('./hsync');

const [defaultCon] = config.connections;
if (!defaultCon.hsyncServer && !defaultCon.dynamicHost) {
  defaultCon.dynamicHost = config.defaultDynamicHost;
}

config.connections.forEach((conConfig) => {
  const con = createConnection(conConfig);
});
