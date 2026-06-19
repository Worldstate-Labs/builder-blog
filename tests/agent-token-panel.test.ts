import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAccessDevice,
  describeAccessStatus,
  formatRelativeCompact,
  sortAccessTokensByRecentConnection,
  type AgentTokenListItem,
} from "../src/components/AgentTokenPanel";

function token(overrides: Partial<AgentTokenListItem>): AgentTokenListItem {
  return {
    id: "token_1",
    name: "Mobile access",
    createdAt: "2026-06-07T00:00:00.000Z",
    lastUsedAt: null,
    lastIp: null,
    lastUserAgent: null,
    lastHostname: null,
    lastPlatform: null,
    lastUser: null,
    revokedAt: null,
    ...overrides,
  };
}

test("access key device labels normalize mobile platform casing", () => {
  assert.equal(
    describeAccessDevice(token({ lastPlatform: "ios 26.6", lastUserAgent: "Mobile Safari iPhone" })),
    "iOS 26.6 iPhone",
  );
  assert.equal(
    describeAccessDevice(token({ lastPlatform: "ipadOS 26.6", lastUserAgent: "Mobile Safari iPad" })),
    "iPadOS 26.6 iPad",
  );
  assert.equal(
    describeAccessDevice(token({ lastPlatform: "android 15", lastUserAgent: "Chrome Mobile" })),
    "Android 15",
  );
});

test("access keys sort by latest connection before creation time", () => {
  const sorted = sortAccessTokensByRecentConnection([
    token({
      id: "created_recently",
      createdAt: "2026-06-07T08:00:00.000Z",
      lastUsedAt: null,
    }),
    token({
      id: "connected_recently",
      createdAt: "2026-06-01T08:00:00.000Z",
      lastUsedAt: "2026-06-07T09:00:00.000Z",
    }),
    token({
      id: "connected_older",
      createdAt: "2026-06-01T08:00:00.000Z",
      lastUsedAt: "2026-06-02T09:00:00.000Z",
    }),
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["connected_recently", "created_recently", "connected_older"],
  );
});

test("access key status labels read like authorized device activity", () => {
  assert.equal(
    describeAccessStatus(
      token({ lastUsedAt: "2026-06-07T09:00:00.000Z" }),
      false,
    ),
    "Last connected Jun 7, 2026, 9:00 AM UTC",
  );
  assert.equal(describeAccessStatus(token({ lastUsedAt: null }), true), "Never connected");
  assert.match(
    describeAccessStatus(token({ revokedAt: "2026-06-07T10:00:00.000Z" }), false),
    /^Revoked Jun 7, 2026, 10:00 AM UTC$/,
  );
});

test("access key mobile rows match device plus last connection summary", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-06-08T04:00:00.000Z");
  try {
    const mobileToken = token({
      lastPlatform: "ios 26.6",
      lastUserAgent: "Mobile Safari iPhone",
      lastUsedAt: "2026-06-07T09:00:00.000Z",
    });

    assert.equal(describeAccessDevice(mobileToken), "iOS 26.6 iPhone");
    assert.equal(formatRelativeCompact(mobileToken.lastUsedAt!, true), "19 hr ago");
    assert.equal(describeAccessStatus(mobileToken, true), "Last connected 19 hr ago");
  } finally {
    Date.now = originalNow;
  }
});
