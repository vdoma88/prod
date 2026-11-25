const esbuild = require('esbuild')
esbuild.buildSync({
  entryPoints: ['scripts/engine-entry.js'],
  outfile: 'src/generated/matrix-engine.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2020'],
})
