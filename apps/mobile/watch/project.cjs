const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sourceFiles = () =>
  fs
    .readdirSync(path.join(__dirname, "Sources"))
    .filter((x) => x.endsWith(".swift"))
    .sort();
function settings({ bundleId, version, buildNumber, teamId = "", companion = false }) {
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
    ...(companion
      ? { INFOPLIST_KEY_WKCompanionAppBundleIdentifier: bundleId }
      : { INFOPLIST_KEY_WKWatchOnly: "YES" }),
    INFOPLIST_KEY_NSMicrophoneUsageDescription:
      '"Record a message for transcription on your T3 environment. Nothing is sent until you review the draft."',
    MARKETING_VERSION: version,
    CURRENT_PROJECT_VERSION: buildNumber,
    APS_ENVIRONMENT: "development",
    CODE_SIGN_STYLE: "Automatic",
    DEVELOPMENT_TEAM: teamId,
    CODE_SIGN_ENTITLEMENTS: '"$(SRCROOT)/T3Watch/Watch.entitlements"',
    LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
    SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
    SKIP_INSTALL: companion ? "YES" : "NO",
  };
}
function copySources(destination) {
  fs.mkdirSync(destination, { recursive: true });
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
  project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  const group = project.addPbxGroup([], "T3Watch", "T3Watch");
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  for (const file of sourceFiles())
    project.addSourceFile(file, { target: target.uuid }, group.uuid);
  const list = objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  for (const entry of list.buildConfigurations) {
    const config = objects.XCBuildConfiguration[entry.value].buildSettings;
    delete config.INFOPLIST_FILE;
    Object.assign(config, settings({ ...options, companion: true }));
    config.APS_ENVIRONMENT =
      objects.XCBuildConfiguration[entry.value].name === "Release" ? "production" : "development";
  }
  const phase = project.addBuildPhase(
    [],
    "PBXCopyFilesBuildPhase",
    "Embed Watch Content",
    host,
    "watch2_app",
    '"$(CONTENTS_FOLDER_PATH)/Watch"',
  );
  const buildId = project.generateUuid();
  objects.PBXBuildFile[buildId] = {
    isa: "PBXBuildFile",
    fileRef: target.pbxNativeTarget.productReference,
    settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
  };
  phase.buildPhase.files.push({ value: buildId, comment: "T3Watch.app in Embed Watch Content" });
}
function generate(destination, options) {
  const projectDir = path.join(destination, "T3Watch.xcodeproj");
  fs.mkdirSync(projectDir, { recursive: true });
  copySources(path.join(destination, "T3Watch"));
  const id = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24).toUpperCase();
  const objects = {};
  const add = (name, object) => {
    objects[id(name)] = object;
    return id(name);
  };
  const files = sourceFiles().map((file) =>
    add(file, {
      isa: "PBXFileReference",
      lastKnownFileType: "sourcecode.swift",
      path: file,
      sourceTree: "<group>",
    }),
  );
  const builds = files.map((file) => add("build" + file, { isa: "PBXBuildFile", fileRef: file }));
  const product = add("product", {
    isa: "PBXFileReference",
    explicitFileType: "wrapper.application",
    path: "T3Watch.app",
    sourceTree: "BUILT_PRODUCTS_DIR",
  });
  const group = add("sources", {
    isa: "PBXGroup",
    path: "T3Watch",
    sourceTree: "<group>",
    children: files,
  });
  const products = add("products", {
    isa: "PBXGroup",
    name: "Products",
    sourceTree: "<group>",
    children: [product],
  });
  const root = add("root", { isa: "PBXGroup", sourceTree: "<group>", children: [group, products] });
  const sources = add("sourcePhase", {
    isa: "PBXSourcesBuildPhase",
    buildActionMask: 2147483647,
    files: builds,
    runOnlyForDeploymentPostprocessing: 0,
  });
  const frameworks = add("frameworks", {
    isa: "PBXFrameworksBuildPhase",
    buildActionMask: 2147483647,
    files: [],
    runOnlyForDeploymentPostprocessing: 0,
  });
  function configs(prefix, buildSettings) {
    const refs = ["Debug", "Release"].map((name) =>
      add(prefix + name, {
        isa: "XCBuildConfiguration",
        name,
        buildSettings: {
          ...buildSettings,
          ...(name === "Release" && prefix === "target"
            ? { SWIFT_OPTIMIZATION_LEVEL: "-O", APS_ENVIRONMENT: "production" }
            : {}),
        },
      }),
    );
    return add(prefix + "configs", {
      isa: "XCConfigurationList",
      buildConfigurations: refs,
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: "Release",
    });
  }
  const cleanSettings = Object.fromEntries(
    Object.entries(settings(options)).map(([k, v]) => [k, String(v).replace(/^"|"$/g, "")]),
  );
  const target = add("target", {
    isa: "PBXNativeTarget",
    name: "T3Watch",
    productName: "T3Watch",
    productReference: product,
    productType: "com.apple.product-type.application",
    buildConfigurationList: configs("target", cleanSettings),
    buildPhases: [sources, frameworks],
    buildRules: [],
    dependencies: [],
  });
  const project = add("project", {
    isa: "PBXProject",
    attributes: { LastUpgradeCheck: "2640" },
    buildConfigurationList: configs("project", {}),
    compatibilityVersion: "Xcode 14.0",
    developmentRegion: "en",
    knownRegions: ["en", "Base"],
    mainGroup: root,
    productRefGroup: products,
    projectDirPath: "",
    projectRoot: "",
    targets: [target],
  });
  const serialize = (v) =>
    Array.isArray(v)
      ? "(" + v.map(serialize).join(", ") + ")"
      : v && typeof v === "object"
        ? "{\n" +
          Object.entries(v)
            .map(([k, v]) => `${JSON.stringify(k)} = ${serialize(v)};`)
            .join("\n") +
          "\n}"
        : JSON.stringify(v);
  fs.writeFileSync(
    path.join(projectDir, "project.pbxproj"),
    "// !$*UTF8*$!\n" +
      serialize({
        archiveVersion: 1,
        classes: {},
        objectVersion: 56,
        objects,
        rootObject: project,
      }),
  );
  const schemes = path.join(projectDir, "xcshareddata", "xcschemes");
  fs.mkdirSync(schemes, { recursive: true });
  fs.writeFileSync(
    path.join(schemes, "T3Watch.xcscheme"),
    `<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2640" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${target}" BuildableName="T3Watch.app" BlueprintName="T3Watch" ReferencedContainer="container:T3Watch.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${target}" BuildableName="T3Watch.app" BlueprintName="T3Watch" ReferencedContainer="container:T3Watch.xcodeproj"/></BuildableProductRunnable></LaunchAction><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>`,
  );
  return projectDir;
}
module.exports = { settings, copySources, addToProject, generate };
if (require.main === module)
  console.log(
    generate(path.resolve(process.argv[2] || "../../../.t3/watch-native"), {
      bundleId: process.env.T3CODE_IOS_FORK_BUNDLE_ID || "com.viktorrudi.t3code",
      version: process.env.T3CODE_MOBILE_VERSION || "2.3.0",
      buildNumber: process.env.T3CODE_IOS_BUILD_NUMBER || "7",
      teamId: process.env.T3CODE_IOS_FORK_TEAM_ID || "",
    }),
  );
