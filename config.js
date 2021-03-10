const baseConfig = {
  hsyncServer: process.env.HSYNC_SERVER || 'ws://localhost:3101',
  hsyncSecret: process.env.HSYNC_SECRET, // keep it secret, keep it safe!
  localHost: process.env.LOCAL_HOST || 'localhost', // host of local server
  port: process.env.PORT || 3000, // port of local server
  hsyncBase: process.env.HSYNC_BASE || '_hs',
  keepalive: parseInt(process.env.HSYNC_KEEP_ALIVE) || 25,
  dynUrl: process.env.HSYNC_DYN_URL || 'https://d.shiv.to/_hs/dyn',
  // dynUrl: process.env.HSYNC_DYN_URL || 'http://localhost:3101/_hs/dyn',
};

baseConfig.dynProtocol = (new URL(baseConfig.dynUrl)).protocol.toLowerCase();
baseConfig.dynWsProtocol = baseConfig.dynProtocol === 'https:' ? 'wss:' : 'ws:';


const connections = [baseConfig];
const keys = Object.keys(process.env);
keys.forEach((k) => {
  if(k.startsWith('HSYNC_SERVER_')) {
    const name = k.substring(13);
    const value = process.env[k];
    if (name && value) {
      console.log('name', name, value);
      connections.push({
        name,
        hsyncServer: value,
        hsyncSecret: process.env['HSYNC_SECRET_' + name] || baseConfig.hsyncSecret,
        localHost: process.env['LOCAL_HOST_' + name] || baseConfig.localHost,
        port: process.env['PORT_' + name] || baseConfig.port,
        hsyncBase: process.env['HSYNC_BASE_' + name] || baseConfig.hsyncBase,
        keepalive: parseInt(process.env['HSYNC_KEEP_ALIVE_' + name]) || baseConfig.keepalive,
      })
    }
  }
})

const config = Object.assign({}, baseConfig, {connections});

module.exports = config;