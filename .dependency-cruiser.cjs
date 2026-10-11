const { createDependencyConfiguration } = require("./tools/dependency-cruiser/dependency-policy.cjs");

module.exports = createDependencyConfiguration(__dirname);
