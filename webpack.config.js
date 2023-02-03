const path = require('path');

const mode = process.env.BUILD_MODE || 'development';

module.exports = {
  entry: "./hsync-web.js",
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: mode === 'development' ? 'hsync.js' : 'hsync.min.js'
  },
  mode,
  resolve: {
    alias: {
    }
  },
  node: {
    global: true,
  }
};