const path = require("path");
const baseConfig = require("./craco.config");

const configureBase = baseConfig.webpack.configure;
baseConfig.webpack.configure = (webpackConfig, context) => {
  const configured = configureBase(webpackConfig, context);
  configured.entry = path.resolve(__dirname, "src/public-index.js");
  return configured;
};

module.exports = baseConfig;
