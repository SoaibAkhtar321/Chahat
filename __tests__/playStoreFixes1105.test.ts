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
