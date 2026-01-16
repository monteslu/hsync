const p = globalThis.process || { env: {} };
const { env } = p;

const baseConfig = {
  hsyncServer: env.HSYNC_SERVER, // something like 'wss://mydevice.mydomain.com'
  hsyncSecret: env.HSYNC_SECRET, // keep it secret, keep it safe!
  localHost: env.LOCAL_HOST || 'localhost', // host of local server
  port: env.PORT || 3000, // port of local server
  hsyncBase: env.HSYNC_BASE || '_hs',
  keepalive: parseInt(env.HSYNC_KEEP_ALIVE) || 300,
  dynamicHost: env.HSYNC_DYNAMIC_HOST,
  defaultDynamicHost: 'https://demo.hsync.tech',
  another: 'another',
};

const connections = [baseConfig];
const keys = Object.keys(env);
keys.forEach((k) => {
  if (k.startsWith('HSYNC_SERVER_')) {
    const name = k.substring(13);
    const value = env[k];
    if (name && value) {
      connections.push({
        name,
        hsyncServer: value,
        hsyncSecret: env['HSYNC_SECRET_' + name] || baseConfig.hsyncSecret,
        localHost: env['LOCAL_HOST_' + name] || baseConfig.localHost,
        port: env['PORT_' + name] || baseConfig.port,
        hsyncBase: env['HSYNC_BASE_' + name] || baseConfig.hsyncBase,
        keepalive: parseInt(env['HSYNC_KEEP_ALIVE_' + name]) || baseConfig.keepalive,
        dynamicHost: env['HSYNC_DYNAMIC_HOST_' + name],
      });
    }
  }
});

const config = Object.assign({}, baseConfig, { connections });

export default config;
export { baseConfig, connections };
