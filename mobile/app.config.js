
const fs = require("fs");
const path = require("path");

function resolveGoogleServicesFile({
  envPath,
  projectDir,
  exists = fs.existsSync,
}) {
  if (envPath && exists(envPath)) return envPath;

  if (exists(path.join(projectDir, "google-services.json"))) {
    return "./google-services.json";
  }

  return null;
}

const withGooglePlayIapFlavor = (config) => {
  const { withAppBuildGradle } = require("@expo/config-plugins");

  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    const strategy = "missingDimensionStrategy 'store', 'play'";

    if (contents.includes(strategy)) {
      return config;
    }

    const defaultConfigMatch = contents.match(
      /(^\s*defaultConfig\s*\{)/m
    );

    if (!defaultConfigMatch) {
      throw new Error(
        "Could not find defaultConfig in generated android/app/build.gradle"
      );
    }

    const insertionPoint =
      defaultConfigMatch.index + defaultConfigMatch[0].length;

    contents =
      contents.slice(0, insertionPoint) +
      `\n        ${strategy}` +
      contents.slice(insertionPoint);

    config.modResults.contents = contents;
    return config;
  });
};

// Floating video-call window (picture-in-picture). Android only shrinks an activity into the small movable window
// when the manifest says so, and the activity must handle the size changes itself instead of restarting (a restart
// would drop the call). Expo's default MainActivity already handles most of them; smallestScreenSize is the one it lacks.
const PIP_CONFIG_CHANGES = ["keyboard", "keyboardHidden", "orientation", "screenSize", "smallestScreenSize", "screenLayout", "uiMode"];

function applyPictureInPictureToActivity(activity) {
  activity.$["android:supportsPictureInPicture"] = "true";
  const existing = String(activity.$["android:configChanges"] || "")
    .split("|")
    .filter(Boolean);
  activity.$["android:configChanges"] = [...new Set([...existing, ...PIP_CONFIG_CHANGES])].join("|");
  return activity;
}

const withPictureInPicture = (config) => {
  const { withAndroidManifest } = require("@expo/config-plugins");

  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const main = activities.find((item) => item.$["android:name"] === ".MainActivity");
    if (!main) {
      throw new Error("Could not find .MainActivity in the generated AndroidManifest.xml");
    }
    applyPictureInPictureToActivity(main);
    return config;
  });
};

// Agora's "full" SDK ships ~20 optional native feature libraries per CPU architecture (virtual background, face
// detection, lip sync, AI noise suppression, screen capture, ...). Chahat only uses plain 1:1 voice/video calls, so
// leaving them out cuts tens of MB from the APK. The SDK loads each of these only when its feature is enabled.
const UNUSED_AGORA_NATIVE_LIBS = [
  "libagora_ai_echo_cancellation_extension.so",
  "libagora_ai_echo_cancellation_ll_extension.so",
  "libagora_ai_noise_suppression_extension.so",
  "libagora_ai_noise_suppression_ll_extension.so",
  "libagora_audio_beauty_extension.so",
  "libagora_clear_vision_extension.so",
  "libagora_content_inspect_extension.so",
  "libagora_face_capture_extension.so",
  "libagora_face_detection_extension.so",
  "libagora_lip_sync_extension.so",
  "libagora_pvc_extension.so",
  "libagora_screen_capture_extension.so",
  "libagora_segmentation_extension.so",
  "libagora_spatial_audio_extension.so",
  "libagora_super_resolution_extension.so",
  "libagora_udrm3_extension.so",
  "libagora_drm_loader_extension.so",
  "libagora_video_av1_decoder_extension.so",
  "libagora_video_av1_encoder_extension.so",
  "libagora_video_quality_analyzer_extension.so",
];

const withSlimAgoraNativeLibs = (config) => {
  const { withAppBuildGradle } = require("@expo/config-plugins");

  return withAppBuildGradle(config, (config) => {
    const marker = "// chahat: exclude unused Agora native libraries";
    if (config.modResults.contents.includes(marker)) return config;

    const excludes = UNUSED_AGORA_NATIVE_LIBS.map((lib) => `'**/${lib}'`).join(", ");
    config.modResults.contents +=
      `\n${marker}\nandroid {\n    packagingOptions {\n        jniLibs {\n            excludes += [${excludes}]\n        }\n    }\n}\n`;
    return config;
  });
};

// Agora's screen-capture module merges a mediaProjection foreground service and the
// FOREGROUND_SERVICE_MEDIA_PROJECTION permission into the app. Chahat never shares or records the screen, and
// Google Play requires a declaration + video for that service type, so strip them from the merged manifest.
const AGORA_SCREEN_SHARE_COMPONENTS = {
  service: ["io.agora.rtc2.extensions.MediaProjectionMgr$LocalScreenCaptureAssistantService"],
  activity: ["io.agora.rtc2.extensions.MediaProjectionMgr$LocalScreenCaptureAssistantActivity"],
};
const REMOVED_PERMISSIONS = ["android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"];

function removeScreenShareFromManifest(manifest) {
  manifest.$ = manifest.$ || {};
  manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
  const perms = (manifest["uses-permission"] = manifest["uses-permission"] || []);
  for (const name of REMOVED_PERMISSIONS) {
    const existing = perms.find((item) => item.$["android:name"] === name);
    if (existing) existing.$["tools:node"] = "remove";
    else perms.push({ $: { "android:name": name, "tools:node": "remove" } });
  }
  const application = manifest.application?.[0];
  if (application) {
    for (const [tag, names] of Object.entries(AGORA_SCREEN_SHARE_COMPONENTS)) {
      const list = (application[tag] = application[tag] || []);
      for (const name of names) {
        if (!list.some((item) => item.$["android:name"] === name)) {
          list.push({ $: { "android:name": name, "tools:node": "remove" } });
        }
      }
    }
  }
  return manifest;
}

// Removing manifest entries is not enough: react-native-agora pulls in io.agora.rtc:full-screen-sharing, whose
// manifest declares the mediaProjection foreground service. Excluding the module from the app means none of it
// (classes, service, permission) reaches the AAB. Agora's own fix for apps that do not use screen sharing.
const AGORA_SCREEN_SHARE_EXCLUDE_MARKER = "// chahat: exclude Agora screen-sharing module";
const withoutAgoraScreenShareModule = (config) => {
  const { withAppBuildGradle } = require("@expo/config-plugins");
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(AGORA_SCREEN_SHARE_EXCLUDE_MARKER)) return config;
    config.modResults.contents +=
      `\n${AGORA_SCREEN_SHARE_EXCLUDE_MARKER}\nconfigurations.configureEach {\n    exclude group: "io.agora.rtc", module: "full-screen-sharing"\n}\n`;
    return config;
  });
};

const withoutScreenShare = (config) => {
  const { withAndroidManifest } = require("@expo/config-plugins");
  return withAndroidManifest(config, (config) => {
    removeScreenShareFromManifest(config.modResults.manifest);
    return config;
  });
};

module.exports = (context) => {
  let config = context.config;

  const googleServicesFile = resolveGoogleServicesFile({
    envPath: process.env.GOOGLE_SERVICES_JSON,
    projectDir: __dirname,
  });

  if (googleServicesFile) {
    config = {
      ...config,
      android: {
        ...config.android,
        googleServicesFile,
      },
    };
  }

  return withoutAgoraScreenShareModule(withoutScreenShare(withPictureInPicture(withSlimAgoraNativeLibs(withGooglePlayIapFlavor(config)))));
};

module.exports.resolveGoogleServicesFile = resolveGoogleServicesFile;
module.exports.UNUSED_AGORA_NATIVE_LIBS = UNUSED_AGORA_NATIVE_LIBS;
module.exports.applyPictureInPictureToActivity = applyPictureInPictureToActivity;
module.exports.removeScreenShareFromManifest = removeScreenShareFromManifest;
module.exports.withoutAgoraScreenShareModule = withoutAgoraScreenShareModule;
