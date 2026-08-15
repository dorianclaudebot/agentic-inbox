/**
 * Generate a Trusted Web Activity Android project from android/twa-manifest.json
 * and build a debug APK.
 *
 *   node scripts/android/build-apk.mjs
 *
 * Bubblewrap's CLI prompts to install a JDK, so this writes the TWA project
 * directly and reuses the Gradle wrapper checked in under scripts/android/wrapper/.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const androidDir = join(root, "android");
const wrapperDir = join(root, "scripts/android/wrapper");
const twaManifestPath = join(androidDir, "twa-manifest.json");
const defaultSdk = join(homedir(), "Library", "Android", "sdk");
const brewJdks = ["/opt/homebrew/opt/openjdk", "/usr/local/opt/openjdk"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  for (const home of brewJdks) {
    if (existsSync(home)) return home;
  }
  const probed = spawnSync("/usr/libexec/java_home", [], { encoding: "utf8" });
  if (probed.status === 0 && probed.stdout.trim()) {
    return probed.stdout.trim();
  }
  return undefined;
}

function resolveSdkRoot() {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdk;
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (!existsSync(twaManifestPath)) {
  fail(`Missing ${twaManifestPath}`);
}

const manifest = JSON.parse(readFileSync(twaManifestPath, "utf8"));
const packageId = manifest.packageId;
const host = manifest.host;
const startUrl = manifest.startUrl || "/";
const defaultUrl = `https://${host}${startUrl.startsWith("/") ? startUrl : `/${startUrl}`}`;
const appName = manifest.launcherName || manifest.name || "Inbox";
const themeColor = (manifest.themeColor || "#2563EB").replace("#", "");
const backgroundColor = (manifest.backgroundColor || "#FFFFFF").replace("#", "");

if (!packageId || !host) {
  fail("twa-manifest.json must set packageId and host");
}

mkdirSync(androidDir, { recursive: true });

const sdkRoot = resolveSdkRoot();
write(
  join(androidDir, "local.properties"),
  `sdk.dir=${sdkRoot.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`,
);

write(
  join(androidDir, "settings.gradle"),
  `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "inbox"
include ':app'
`,
);

write(
  join(androidDir, "build.gradle"),
  `plugins {
    id 'com.android.application' version '9.2.0' apply false
}
`,
);

write(
  join(androidDir, "gradle.properties"),
  `org.gradle.jvmargs=-Xmx1536m
android.useAndroidX=true
`,
);

write(
  join(androidDir, "gradle/wrapper/gradle-wrapper.properties"),
  `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-all.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,
);

for (const name of ["gradlew", "gradlew.bat", "gradle-wrapper.jar"]) {
  const from = join(wrapperDir, name);
  if (!existsSync(from)) fail(`Missing Gradle wrapper file ${from}`);
  const to =
    name === "gradle-wrapper.jar"
      ? join(androidDir, "gradle/wrapper/gradle-wrapper.jar")
      : join(androidDir, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
chmodSync(join(androidDir, "gradlew"), 0o755);

write(
  join(androidDir, "app/build.gradle"),
  `plugins {
    id 'com.android.application'
}

android {
    namespace '${packageId}'
    compileSdk 36

    defaultConfig {
        applicationId '${packageId}'
        minSdk 26
        targetSdk 36
        versionCode ${Number(manifest.appVersionCode) || 1}
        versionName '${manifest.appVersionName || "1"}'
    }

    buildTypes {
        release {
            minifyEnabled false
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.7.1'
    implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.6.2'
}
`,
);

write(
  join(androidDir, "app/src/main/AndroidManifest.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.InboxTwa">
        <activity
            android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
            android:exported="true"
            android:label="@string/app_name">
            <meta-data
                android:name="android.support.customtabs.trusted.DEFAULT_URL"
                android:value="${xmlEscape(defaultUrl)}" />
            <meta-data
                android:name="android.support.customtabs.trusted.STATUS_BAR_COLOR"
                android:resource="@color/theme_color" />
            <meta-data
                android:name="android.support.customtabs.trusted.NAVIGATION_BAR_COLOR"
                android:resource="@color/navigation_color" />
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${xmlEscape(host)}" />
            </intent-filter>
        </activity>
        <service
            android:name="com.google.androidbrowserhelper.trusted.DelegationService"
            android:exported="true">
            <intent-filter>
                <action android:name="android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </service>
    </application>
</manifest>
`,
);

write(
  join(androidDir, "app/src/main/res/values/strings.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${xmlEscape(appName)}</string>
</resources>
`,
);

write(
  join(androidDir, "app/src/main/res/values/colors.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="theme_color">#${themeColor}</color>
    <color name="navigation_color">#000000</color>
    <color name="background_color">#${backgroundColor}</color>
</resources>
`,
);

write(
  join(androidDir, "app/src/main/res/values/styles.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.InboxTwa" parent="Theme.AppCompat.Light.NoActionBar">
        <item name="android:windowBackground">@color/background_color</item>
        <item name="android:statusBarColor">@color/theme_color</item>
        <item name="android:navigationBarColor">@color/navigation_color</item>
    </style>
</resources>
`,
);

const icon512 = join(root, "public/icon-512.png");
const icon192 = join(root, "public/icon-192.png");
if (!existsSync(icon512) || !existsSync(icon192)) {
  fail("Run npm run android:icons first");
}
const mipmaps = [
  ["mipmap-mdpi", icon192],
  ["mipmap-hdpi", icon192],
  ["mipmap-xhdpi", icon192],
  ["mipmap-xxhdpi", icon192],
  ["mipmap-xxxhdpi", icon512],
];
for (const [folder, source] of mipmaps) {
  const destDir = join(androidDir, "app/src/main/res", folder);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(source, join(destDir, "ic_launcher.png"));
}

const javaHome = resolveJavaHome();
const env = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
};
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${join(javaHome, "bin")}:${env.PATH || ""}`;
}

const result = spawnSync("./gradlew", ["assembleDebug"], {
  cwd: androidDir,
  env,
  stdio: "inherit",
  encoding: "utf8",
});
if (result.status !== 0) {
  fail(`gradlew assembleDebug failed with exit ${result.status ?? "null"}`);
}

const apk = join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");
console.log(`APK: ${apk}`);
