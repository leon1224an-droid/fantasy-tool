module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { targets: { browsers: ['last 2 Chrome versions', 'last 2 Firefox versions', 'last 2 Safari versions'] } }]],
  };
};
