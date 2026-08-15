const PUBLIC_PATHS = new Set([
  "/.well-known/assetlinks.json",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon-192.png",
  "/icon-512.png",
]);

export function isPublicUnauthenticatedPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export interface AssetLinksEnv {
  TWA_PACKAGE_ID?: string;
  TWA_SHA256_FINGERPRINTS?: string;
}

export function assetLinksDocument(env: AssetLinksEnv) {
  const fingerprints = (env.TWA_SHA256_FINGERPRINTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: env.TWA_PACKAGE_ID || "com.example.inbox",
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function webAppManifest() {
  return {
    name: "Agentic Inbox",
    short_name: "Inbox",
    description: "Self-hosted email client with an AI agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
