import { describe, expect, it } from "vitest";

import { comparePluginVersions } from "../../goLiveBypass/update-channel";

describe("linha major v2 do plugin", () => {
  it("mantém beta.1 e beta-1 equivalentes na ordenação do plugin", () => {
    expect(comparePluginVersions("2.0.0-beta.1", "2.0.0-beta-1")).toBe(0);
  });
});
