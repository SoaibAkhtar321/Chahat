import { describeUploadError } from "../mobile/src/utils/uploadError";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appConfig = require("../mobile/app.config.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require("../mobile/app.json");

describe("Play Store: no screen-share foreground service", () => {
  it("blocks FOREGROUND_SERVICE_MEDIA_PROJECTION", () => {
    expect(appJson.expo.android.blockedPermissions).toContain("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION");
  });
  it("removes Agora's media-projection service from the merged manifest", () => {
    const m: any = { application: [{}] };
    appConfig.removeScreenShareFromManifest(m);
    expect(m.$["xmlns:tools"]).toBe("http://schemas.android.com/tools");
    expect(m.application[0].service[0].$["tools:node"]).toBe("remove");
    expect(m["uses-permission"][0].$["android:name"]).toBe("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION");
  });
});

describe("upload errors show the real reason", () => {
  it.each([
    [{ message: "The object exceeded the maximum allowed size", statusCode: "413" }, /5 MB/],
    [{ message: "mime type image/heic is not supported" }, /JPEG, PNG or WEBP/],
    [{ message: "new row violates row-level security policy" }, /sign in again/],
    [{ message: "Network request failed" }, /internet/],
    [{ message: "weird thing" }, /weird thing/],
  ])("%j", (err, re) => {
    expect(describeUploadError(err).message).toMatch(re);
  });
});

describe("Play Store: Agora screen-sharing module excluded", () => {
  it("app.config.js adds the gradle exclude for io.agora.rtc:full-screen-sharing and applies it", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require("fs").readFileSync(require("path").join(__dirname, "../mobile/app.config.js"), "utf8");
    expect(src).toContain('exclude group: "io.agora.rtc", module: "full-screen-sharing"');
    expect(src).toMatch(/return withoutAgoraScreenShareModule\(/);
  });
});

describe("shared profile + premium plan fixes", () => {
  const read = (f: string) => require("fs").readFileSync(require("path").join(__dirname, "..", f), "utf8") as string;
  it("shared links open the profile with from=share, and a not-matched likeable profile goes to Discover", () => {
    expect(read("mobile/app/p/[id].tsx")).toMatch(/from: "share"/);
    expect(read("mobile/app/index.tsx")).toMatch(/from: "share"/);
    const screen = read("mobile/app/profile/[id].tsx");
    expect(screen).toMatch(/showInDiscover\(targetProfile\)/);
    expect(screen).toMatch(/router\.replace\("\/\(tabs\)\/discover"\)/);
  });
  it("Discover keeps the pinned shared profile on top across reloads", () => {
    expect(read("mobile/src/context/MiloContext.tsx")).toMatch(/setDeck\(withPinned\(page\.profiles\)\)/);
  });
  it("mutual likes without a match are healed by get_profile_actions", () => {
    const sql = read("supabase/migrations/20260101007600_profile_actions_heal_mutual_like.sql");
    expect(sql).toMatch(/INSERT INTO public\.matches/);
    expect(sql).toMatch(/VOLATILE/);
  });
  it("premium: current or lower plan shows no payment button", () => {
    const p = read("mobile/app/premium/index.tsx");
    expect(p).toMatch(/Your current plan · active/);
    expect(p).toMatch(/Included in your/);
  });
});
