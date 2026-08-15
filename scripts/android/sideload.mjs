/**
 * Sideload the debug APK to the personal profile (user 0) only.
 *
 *   node scripts/android/sideload.mjs
 *
 * Set ANDROID_SERIAL to pick a device. Otherwise the first `adb devices`
 * entry with status "device" is used. Do not omit --user 0: a bare
 * `adb install -r` installs for every user, including Private Space.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apk = join(root, "android/app/build/outputs/apk/debug/app-debug.apk");
const personalUser = "0";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function adb(args, options = {}) {
  const result = spawnSync("adb", args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    fail(`adb failed to start: ${result.error.message}`);
  }
  return result;
}

function firstDeviceSerial() {
  const listed = adb(["devices"]);
  if (listed.status !== 0) {
    fail(`adb devices failed: ${(listed.stderr || listed.stdout || "").trim()}`);
  }
  const lines = (listed.stdout || "").split("\n").slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [serial, status] = trimmed.split(/\s+/);
    if (serial && status === "device") return serial;
  }
  return undefined;
}

if (!existsSync(apk)) {
  fail(`Missing ${apk}. Run npm run android:apk first.`);
}

const serial = process.env.ANDROID_SERIAL || firstDeviceSerial();
if (!serial) {
  fail("No adb device found. Connect a phone or set ANDROID_SERIAL.");
}

const args = ["-s", serial, "install", "-r", "--user", personalUser, apk];
console.log(`adb ${args.join(" ")}`);
const installed = adb(args, { stdio: "inherit" });
if (installed.status !== 0) {
  fail(`adb install failed with exit ${installed.status ?? "null"}`);
}
