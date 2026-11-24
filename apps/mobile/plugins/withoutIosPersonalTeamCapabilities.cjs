const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosPersonalTeamCapabilities(config, options = {}) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    delete modConfig.modResults["com.apple.developer.applesignin"];
    if (!options.keepAppGroups) {
      delete modConfig.modResults["com.apple.security.application-groups"];
    }
    return modConfig;
  });
};
