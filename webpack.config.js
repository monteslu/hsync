import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mode = process.env.BUILD_MODE || 'development';

export default {
  entry: './hsync-web.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: mode === 'development' ? 'hsync.js' : 'hsync.min.js',
    library: {
      name: 'hsync',
      type: 'umd',
      export: 'default',
    },
    globalObject: 'this',
  },
  mode,
  optimization: {
    usedExports: true,
    sideEffects: true,
  },
  resolve: {
    alias: {},
  },
  node: {
    global: true,
  },
  performance: {
    hints: false,
  },
};
