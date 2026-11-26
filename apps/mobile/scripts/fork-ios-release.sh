#!/bin/bash
set -euo pipefail
shopt -s nullglob
umask 077

cd "$(dirname "$0")/.."
repo_root=$(git rev-parse --show-toplevel)
releases=${T3CODE_IOS_FORK_RELEASES_DIR:-"$HOME/Library/Application Support/T3 Code Personal/Releases"}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

verify_archive() {
  local app="$archive/Products/Applications/T3CodePersonal.app"
  local info="$app/Info.plist"
  [[ $(plist_value "$info" CFBundleIdentifier) == "$bundle_id" ]] || fail "Unexpected app bundle ID."
  [[ $(plist_value "$info" CFBundleShortVersionString) == "$version" ]] || fail "Unexpected app version."
  [[ -s "$app/main.jsbundle" ]] || fail "Archive is missing its embedded JavaScript bundle."
  local extension extension_id has_widgets=0 has_sharing=0
  for extension in "$app"/PlugIns/*.appex; do
    extension_id=$(plist_value "$extension/Info.plist" CFBundleIdentifier)
    case "$extension_id" in
      "$bundle_id.widgets") has_widgets=1 ;;
      "$bundle_id.sharing") has_sharing=1 ;;
      *) fail "Unexpected extension bundle ID: $extension_id" ;;
    esac
    [[ $(plist_value "$extension/Info.plist" CFBundleShortVersionString) == "$version" ]] || fail "Extension version does not match the app."
  done
  [[ $has_widgets == 1 && $has_sharing == 1 ]] || fail "Archive is missing an iOS extension."
  local watch="$app/Watch/T3Watch.app"
  if [[ ${T3CODE_IOS_WATCH:-0} == 1 || -d "$watch" ]]; then
  [[ -d "$watch" ]] || fail "Archive is missing the personal Watch app."
  [[ $(plist_value "$watch/Info.plist" CFBundleIdentifier) == "$bundle_id.watchkitapp" ]] || fail "Unexpected Watch bundle ID."
  [[ $(plist_value "$watch/Info.plist" CFBundleShortVersionString) == "$version" ]] || fail "Watch version does not match the app."
  [[ $(plist_value "$watch/Info.plist" CFBundleVersion) == $(plist_value "$info" CFBundleVersion) ]] || fail "Watch build does not match the app."
  codesign --verify --strict "$watch"
  fi
  codesign --verify --deep --strict "$app"
  local signature
  signature=$(codesign -dv --verbose=4 "$app" 2>&1)
  [[ $(sed -n 's/^TeamIdentifier=//p' <<< "$signature") == "$team_id" ]] || fail "Unexpected signing team."
  archive_cdhash=$(sed -n 's/^CDHash=//p' <<< "$signature")
  [[ -n $archive_cdhash ]] || fail "Archive signature is missing its code directory hash."
}

case "${1:-}" in
  plan|archive)
    [[ $# == 2 && $2 =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Pass the integrated upstream stable tag, for example v0.1.11."
    upstream_tag=$2
    upstream_sha=$(git rev-parse --verify "refs/tags/$upstream_tag^{commit}")
    source_sha=$(git rev-parse HEAD)
    git merge-base --is-ancestor "$upstream_sha" "$source_sha" || fail "$upstream_tag has not been integrated into this checkout."
    latest_integrated_tag=$(git tag --merged "$source_sha" --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ && !found { print; found=1 }')
    [[ $upstream_tag == "$latest_integrated_tag" ]] || fail "Use the checkout's latest integrated stable tag, $latest_integrated_tag."
    export T3CODE_IOS_FORK=1 T3CODE_IOS_FORK_DEVICE_BUILD=0 T3CODE_IOS_PERSONAL_TEAM=0 APP_VARIANT=production EXPO_NO_GIT_STATUS=1
    export EXPO_PUBLIC_SHOWCASE=0 T3_SHOWCASE_CAPTURE_BUILD=0
    export T3CODE_IOS_FORK_TEAM_ID=${T3CODE_IOS_FORK_TEAM_ID:?Set the Apple Developer team ID}
    team_id=$T3CODE_IOS_FORK_TEAM_ID
    [[ -x node_modules/.bin/expo ]] || fail "Install this checkout's mobile workspace dependencies first."
    config=$(node_modules/.bin/expo config --type public --json)
    identity=$(node -e '
      const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      if (!config.extra?.iosFork || config.updates?.enabled !== false ||
          config.name !== "T3 Code Personal" || config.ios.appleTeamId !== process.argv[1] ||
          !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(config.ios.bundleIdentifier) ||
          !/^\d+\.\d+\.\d+$/.test(config.version)) {
        throw new Error("Expected the personal iOS release config and a numeric app version.");
      }
      console.log(config.ios.bundleIdentifier, config.version);
    ' "$team_id" <<< "$config")
    read -r bundle_id version <<< "$identity"
    printf 'Source %s\nUpstream %s (%s)\nBundle %s, version %s, team %s\nReleases %s\n' \
      "$source_sha" "$upstream_tag" "$upstream_sha" "$bundle_id" "$version" "$team_id" "$releases"
    if [[ $1 == plan ]]; then
      exit 0
    fi
    [[ -z $(git status --porcelain) ]] || fail "Archive from an isolated checkout of the reviewed commit."
    [[ $releases == /* ]] || fail "Set T3CODE_IOS_FORK_RELEASES_DIR to an absolute path."
    xcode_version=$(xcrun xcodebuild -version)
    mkdir -p "$releases"
    release_dir=$(mktemp -d "$releases/$(date -u +%Y%m%dT%H%M%SZ)-${source_sha:0:12}.XXXXXX")
    archive="$release_dir/T3CodePersonal.xcarchive"
    printf 'Archive and build log: %s\n' "$release_dir"
    if ! (
      node_modules/.bin/expo prebuild --clean --platform ios --no-install &&
      pod install --project-directory=ios &&
      xcrun xcodebuild -workspace ios/T3CodePersonal.xcworkspace -scheme T3CodePersonal \
        -configuration Release -destination 'generic/platform=iOS' -archivePath "$archive" \
        -derivedDataPath "$repo_root/.t3/ios-fork/release-derived" -jobs 2 \
        -allowProvisioningUpdates COMPILER_INDEX_STORE_ENABLE=NO archive
    ) > "$release_dir/archive.log" 2>&1; then
      fail "Archive failed. See $release_dir/archive.log."
    fi
    verify_archive
    [[ $(git rev-parse HEAD) == "$source_sha" && -z $(git status --porcelain) ]] || fail "Source changed while archiving."
    node -e '
      const [sourceCommit, upstreamTag, upstreamCommit, bundleIdentifier, version, teamId, archiveCdhash, xcodeVersion] = process.argv.slice(1);
      console.log(JSON.stringify({ sourceCommit, upstreamTag, upstreamCommit, bundleIdentifier, version, teamId,
        archiveCdhash, xcodeVersion, archivedAt: new Date().toISOString() }, null, 2));
    ' "$source_sha" "$upstream_tag" "$upstream_sha" "$bundle_id" "$version" "$team_id" "$archive_cdhash" "$xcode_version" > "$release_dir/archive.json"
    printf 'Signed archive verified: %s\n' "$archive"
    ;;
  upload)
    [[ $# == 2 && -f $2/archive.json ]] || fail "Pass the release directory containing archive.json."
    release_dir=$(cd "$2" && pwd -P)
    archive="$release_dir/T3CodePersonal.xcarchive"
    identity=$(node -e '
      const {bundleIdentifier, version, teamId, archiveCdhash} = require(process.argv[1]);
      if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier) ||
          /^com\.t3tools\.t3code(?:\.|$)/i.test(bundleIdentifier) ||
          !/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Z0-9]{10}$/.test(teamId) ||
          !/^[a-f0-9]{40}$/.test(archiveCdhash)) {
        throw new Error("Invalid personal iOS archive receipt.");
      }
      console.log(bundleIdentifier, version, teamId, archiveCdhash);
    ' "$release_dir/archive.json")
    read -r bundle_id version team_id expected_cdhash <<< "$identity"
    verify_archive
    [[ $archive_cdhash == "$expected_cdhash" ]] || fail "Archive signature does not match the recorded build."
    # Leave the attempt recorded even if Xcode is interrupted after Apple receives the upload.
    mkdir "$release_dir/upload" || fail "An upload was already attempted. Check App Store Connect and the upload log before retrying."
    options="$release_dir/upload/ExportOptions.plist"
    cat > "$options" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$team_id</string>
  <key>manageAppVersionAndBuildNumber</key><true/>
  <key>testFlightInternalTestingOnly</key><true/>
</dict></plist>
EOF
    printf 'Internal TestFlight upload log: %s/upload/upload.log\n' "$release_dir"
    if ! xcrun xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" \
      -exportPath "$release_dir/upload/export" -allowProvisioningUpdates > "$release_dir/upload/upload.log" 2>&1; then
      fail "Upload failed or was interrupted. See $release_dir/upload/upload.log and check App Store Connect before retrying."
    fi
    date -u +%Y-%m-%dT%H:%M:%SZ > "$release_dir/upload/accepted-at.txt"
    printf 'Xcode reported upload success. Verify processing and internal group availability in App Store Connect.\n'
    ;;
  *) fail "Usage: ios:fork:distribution (plan|archive) <upstream-stable-tag> | upload <release-directory>" ;;
esac
