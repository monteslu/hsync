const baseConfig = {
  hsyncServer: process.env.HSYNC_SERVER, // something like 'wss://mydevice.mydomain.com'
  hsyncSecret: process.env.HSYNC_SECRET, // keep it secret, keep it safe!
  localHost: process.env.LOCAL_HOST || 'localhost', // host of local server
  port: process.env.PORT || 3000, // port of local server
  hsyncBase: process.env.HSYNC_BASE || '_hs',
  keepalive: parseInt(process.env.HSYNC_KEEP_ALIVE) || 60,
  dynamicHost: process.env.HSYNC_DYNAMIC_HOST,
  defaultDynamicHost: 'https://demo.hsync.tech',
};


const connections = [baseConfig];
const keys = Object.keys(process.env);
keys.forEach((k) => {
  if(k.startsWith('HSYNC_SERVER_')) {
    const name = k.substring(13);
    const value = process.env[k];
    if (name && value) {
      connections.push({
        name,
        hsyncServer: value,
        hsyncSecret: process.env['HSYNC_SECRET_' + name] || baseConfig.hsyncSecret,
        localHost: process.env['LOCAL_HOST_' + name] || baseConfig.localHost,
        port: process.env['PORT_' + name] || baseConfig.port,
        hsyncBase: process.env['HSYNC_BASE_' + name] || baseConfig.hsyncBase,
        keepalive: parseInt(process.env['HSYNC_KEEP_ALIVE_' + name]) || baseConfig.keepalive,
        dynamicHost: process.env['HSYNC_DYNAMIC_HOST_' + name],
      });
    }
  }
})

const config = Object.assign({}, baseConfig, {connections});

module.exports = config;