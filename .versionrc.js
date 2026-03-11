module.exports = {
  // This tells standard-version which files to update
  bumpFiles: [
    {
      filename: "package.json",
      type: "json"
    },
    {
      filename: "Immutable/ARX/Chart.yaml",
      updater: "scripts/helm-updater.js"
    },
    {
      filename: "Immutable/ARX/charts/child-1/Chart.yaml",
      updater: "scripts/helm-updater.js"
    },
    {
      filename: "Immutable/ARX/charts/child-2/Chart.yaml",
      updater: "scripts/helm-updater.js"
    }
  ]
};