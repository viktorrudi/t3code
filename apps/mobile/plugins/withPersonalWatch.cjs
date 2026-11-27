const path = require("node:path");
const { withXcodeProject } = require("expo/config-plugins");
const { copySources, addToProject } = require("../watch/project.cjs");
module.exports = function withPersonalWatch(config) {
  return withXcodeProject(config, (cfg) => {
    copySources(
      path.join(cfg.modRequest.platformProjectRoot, "T3Watch"),
      path.resolve(cfg.modRequest.projectRoot, config.icon),
    );
    addToProject(cfg.modResults, {
      bundleId: config.ios.bundleIdentifier,
      version: config.version,
      buildNumber: config.ios.buildNumber || "1",
      teamId: config.ios.appleTeamId,
    });
    return cfg;
  });
};
