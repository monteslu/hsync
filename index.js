
const config = require('./config');
const { createHsync } = require('./connection');

config.connections.forEach((conConfig) => {
  const con = createHsync(conConfig);
});