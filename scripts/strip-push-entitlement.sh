#!/bin/sh
# Removes the `aps-environment` entitlement from the generated iOS project.
#
# WHEN YOU NEED THIS
# Only for a local build signed with a FREE personal Apple team. Personal teams
# cannot hold the Push Notifications capability, so `expo run:ios --device` fails:
#
#   Personal development teams do not support the Push Notifications capability.
#
# RUN IT AFTER `expo prebuild`, BEFORE `expo run:ios`. Prebuild regenerates the
# file, so a later prebuild undoes this and it has to be run again.
#
# WHY IT IS A SCRIPT AND NOT A CONFIG PLUGIN
# Both the Expo-native routes were tried and neither works. Removing
# expo-notifications from app.json's `plugins` does nothing, because Expo AUTOLINKS a
# module's own config plugin whether or not it is listed. A `withEntitlementsPlist`
# mod does not work either: autolinked plugins are appended AFTER user plugins, so
# the entitlement is re-added after the mod has run -- confirmed by logging, which
# showed the mod receiving an empty entitlements object. Editing the generated file
# afterwards is the only point at which the key can actually be removed.
#
# WHAT IT COSTS
# Remote push notifications cannot work in this build. Nothing else changes: the
# native module is still linked, so permissions, channels and the in-app inbox behave
# normally. This build could not receive a push anyway -- that needs an EAS projectId
# which does not exist yet.
#
# NEVER do this for a release build. A released app without the entitlement can never
# receive a notification, and nothing would report an error.
set -eu

PLIST="ios/OpsProPicker/OpsProPicker.entitlements"

if [ ! -f "$PLIST" ]; then
  echo "No entitlements file at $PLIST - run 'npx expo prebuild -p ios' first." >&2
  exit 1
fi

if /usr/libexec/PlistBuddy -c "Print :aps-environment" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Delete :aps-environment" "$PLIST"
  echo "Removed aps-environment. This build cannot receive push notifications."
else
  echo "aps-environment is already absent. Nothing to do."
fi

echo "--- $PLIST now ---"
cat "$PLIST"
