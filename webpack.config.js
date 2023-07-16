module.exports = {
  entry: {
    jassub: './jassub/assets/jassub.js',
    worker: './jassub/assets/jassub-worker.js'
  },
  output: {
    library: {
      name: 'JASSUB',
      type: 'umd'
    }
  },
  module: {
    rules: [
      {
        test: /\.(?:js|mjs|cjs)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env'
            ]
          }
        }
      }
    ]
  }
}
