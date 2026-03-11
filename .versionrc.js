module.exports = {
  bumpFiles: [
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