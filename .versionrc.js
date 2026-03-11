const glob = require('glob');

const charts = glob.sync("Immutable/**/Chart.yaml");

const bumpFiles = [
  { filename: "package.json", type: "json" }
];

charts.forEach(file => {
  bumpFiles.push({
    filename: file,
    updater: "scripts/helm-updater.js"
  });
});

module.exports = {
  bumpFiles: bumpFiles,
  packageFiles: [{ filename: "package.json", type: "json" }]
};