const fs = require("node:fs");
const path = require("node:path");
const sourceFiles = () =>
  fs
    .readdirSync(path.join(__dirname, "Sources"))
    .filter((x) => x.endsWith(".swift"))
    .sort();
function settings({ bundleId, version, buildNumber, teamId }) {
  return {
    SDKROOT: "watchos",
    SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
    WATCHOS_DEPLOYMENT_TARGET: "10.0",
    TARGETED_DEVICE_FAMILY: "4",
    SWIFT_VERSION: "5.0",
    SWIFT_STRICT_CONCURRENCY: "targeted",
    PRODUCT_NAME: "T3Watch",
    PRODUCT_BUNDLE_IDENTIFIER: bundleId + ".watchkitapp",
    GENERATE_INFOPLIST_FILE: "YES",
    INFOPLIST_KEY_CFBundleDisplayName: '"T3 Code Personal"',
    INFOPLIST_KEY_WKApplication: "YES",
    INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp: "YES",
    INFOPLIST_KEY_WKCompanionAppBundleIdentifier: bundleId,
    INFOPLIST_KEY_NSMicrophoneUsageDescription:
      '"Record a message for transcription on your T3 environment. Nothing is sent until you review the draft."',
    MARKETING_VERSION: version,
    CURRENT_PROJECT_VERSION: buildNumber,
    APS_ENVIRONMENT: "development",
    CODE_SIGN_STYLE: "Automatic",
    ...(teamId ? { DEVELOPMENT_TEAM: teamId } : {}),
    CODE_SIGN_ENTITLEMENTS: '"$(SRCROOT)/T3Watch/Watch.entitlements"',
    LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
    ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
    SKIP_INSTALL: "YES",
  };
}
const contents = (value) => JSON.stringify({ ...value, info: { author: "xcode", version: 1 } });
function copySources(destination, iconPath) {
  const icon = path.join(destination, "Assets.xcassets", "AppIcon.appiconset");
  fs.mkdirSync(icon, { recursive: true });
  fs.writeFileSync(path.join(destination, "Assets.xcassets", "Contents.json"), contents({}));
  fs.copyFileSync(iconPath, path.join(icon, "AppIcon.png"));
  fs.writeFileSync(
    path.join(icon, "Contents.json"),
    contents({
      images: [
        { filename: "AppIcon.png", idiom: "universal", platform: "watchos", size: "1024x1024" },
      ],
    }),
  );
  for (const file of sourceFiles())
    fs.copyFileSync(path.join(__dirname, "Sources", file), path.join(destination, file));
  fs.copyFileSync(
    path.join(__dirname, "Watch.entitlements"),
    path.join(destination, "Watch.entitlements"),
  );
}
function addToProject(project, options) {
  const objects = project.hash.project.objects;
  const targets = project.pbxNativeTargetSection();
  if (
    Object.values(targets).some(
      (v) => typeof v === "object" && v.name?.replaceAll('"', "") === "T3Watch",
    )
  )
    return;
  const host = project.getFirstTarget().uuid;
  const target = project.addTarget(
    "T3Watch",
    "application",
    "T3Watch",
    options.bundleId + ".watchkitapp",
  );
  project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
  const resources = project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  const group = project.addPbxGroup([], "T3Watch", "T3Watch");
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  for (const file of sourceFiles())
    project.addSourceFile(file, { target: target.uuid }, group.uuid);
  const assets = project.generateUuid();
  objects.PBXFileReference[assets] = {
    isa: "PBXFileReference",
    lastKnownFileType: "folder.assetcatalog",
    path: "Assets.xcassets",
    sourceTree: '"<group>"',
  };
  objects.PBXGroup[group.uuid].children.push({ value: assets, comment: "Assets.xcassets" });
  const assetsBuild = project.generateUuid();
  objects.PBXBuildFile[assetsBuild] = { isa: "PBXBuildFile", fileRef: assets };
  resources.buildPhase.files.push({ value: assetsBuild, comment: "Assets.xcassets in Resources" });
  const list = objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  for (const entry of list.buildConfigurations) {
    const config = objects.XCBuildConfiguration[entry.value].buildSettings;
    delete config.INFOPLIST_FILE;
    Object.assign(config, settings(options));
    const release = objects.XCBuildConfiguration[entry.value].name === "Release";
    config.APS_ENVIRONMENT = release ? "production" : "development";
    config.SWIFT_OPTIMIZATION_LEVEL = release ? '"-O"' : '"-Onone"';
    if (!release) config.SWIFT_ACTIVE_COMPILATION_CONDITIONS = '"DEBUG $(inherited)"';
  }
  const phase = project.addBuildPhase(
    [],
    "PBXCopyFilesBuildPhase",
    "Embed Watch Content",
    host,
    "watch2_app",
    '"$(CONTENTS_FOLDER_PATH)/Watch"',
  );
  // addTarget already created the product's build file; embed that one.
  const product = target.pbxNativeTarget.productReference;
  const buildId = Object.keys(objects.PBXBuildFile).find(
    (key) => objects.PBXBuildFile[key].fileRef === product,
  );
  objects.PBXBuildFile[buildId].settings = { ATTRIBUTES: ["RemoveHeadersOnCopy"] };
  phase.buildPhase.files.push({ value: buildId, comment: "T3Watch.app in Embed Watch Content" });
}
module.exports = { copySources, addToProject };
