import assert from "node:assert/strict";
import test from "node:test";

import {
  loadUserContentStatsByEntityId,
  resolveUserContentBuilderIds,
} from "../src/lib/user-content-builders";

async function withAdminEmails<T>(emails: string, fn: () => Promise<T>) {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = emails;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
}

test("content entitlement includes the logical source and its mapped cloud channel", async () => {
  const builderQueries: unknown[] = [];
  const submissionQueries: unknown[] = [];
  const result = await resolveUserContentBuilderIds({
    userId: "user_1",
    logicalBuilderIds: ["personal_1"],
    prisma: {
      builder: {
        async findMany(args: unknown) {
          builderQueries.push(args);
          return [
            { id: "personal_1", entityId: "entity_1" },
            { id: "cloud_1", entityId: "entity_1" },
            { id: "cloud_wrong_entity", entityId: "entity_2" },
          ];
        },
      },
      cloudSourceSubmission: {
        async findMany(args: unknown) {
          submissionQueries.push(args);
          return [
            {
              userBuilderId: "personal_1",
              cloudBuilderId: "cloud_1",
              userBuilder: { entityId: "entity_1" },
              cloudBuilder: { entityId: "entity_1" },
            },
            {
              userBuilderId: "personal_1",
              cloudBuilderId: "cloud_wrong_entity",
              userBuilder: { entityId: "entity_1" },
              cloudBuilder: { entityId: "entity_2" },
            },
            {
              userBuilderId: null,
              cloudBuilderId: "cloud_deleted",
              userBuilder: null,
              cloudBuilder: { entityId: "entity_1" },
            },
          ];
        },
      },
    },
  });

  assert.deepEqual(result.sort(), ["cloud_1", "personal_1"]);
  assert.equal(builderQueries.length, 1);
  assert.equal(submissionQueries.length, 1);
  assert.deepEqual(submissionQueries[0], {
    where: {
      userId: "user_1",
      userBuilderId: { in: ["personal_1"] },
    },
    select: {
      userBuilderId: true,
      cloudBuilderId: true,
      userBuilder: { select: { entityId: true } },
      cloudBuilder: { select: { entityId: true } },
    },
  });
});

test("stopped submissions retain access while deleted logical sources do not", async () => {
  const result = await resolveUserContentBuilderIds({
    userId: "user_1",
    logicalBuilderIds: ["personal_1"],
    prisma: {
      builder: {
        async findMany() {
          return [
            { id: "personal_1", entityId: "entity_1" },
            { id: "cloud_inactive", entityId: "entity_1" },
          ];
        },
      },
      cloudSourceSubmission: {
        async findMany() {
          return [
            {
              userBuilderId: "personal_1",
              cloudBuilderId: "cloud_inactive",
              userBuilder: { entityId: "entity_1" },
              cloudBuilder: { entityId: "entity_1" },
              active: false,
            },
          ];
        },
      },
    },
  });

  assert.deepEqual(result.sort(), ["cloud_inactive", "personal_1"]);
});

test("regular users with no cloud submissions keep their exact logical builder allowlist", async () => {
  const result = await resolveUserContentBuilderIds({
    userId: "user_regular",
    logicalBuilderIds: ["personal_a", "personal_b", "personal_a"],
    prisma: {
      builder: {
        async findMany() {
          return [
            { id: "personal_a", entityId: "entity_a" },
            { id: "personal_b", entityId: "entity_b" },
          ];
        },
      },
      cloudSourceSubmission: {
        async findMany() {
          return [];
        },
      },
    },
  });

  assert.deepEqual(result.sort(), ["personal_a", "personal_b"]);
});

test("content stats dedupe logical and cloud copies by entity and post identity", async () => {
  const result = await loadUserContentStatsByEntityId({
    userId: "user_1",
    logicalBuilderIds: ["personal_1"],
    prisma: {
      builder: {
        async findMany(args: unknown) {
          const input = args as { where?: { id?: { in?: string[] } } };
          if (input.where?.id?.in?.includes("cloud_1")) {
            return [
              { id: "personal_1", entityId: "entity_1" },
              { id: "cloud_1", entityId: "entity_1" },
            ];
          }
          return [{ id: "personal_1", entityId: "entity_1" }];
        },
      },
      cloudSourceSubmission: {
        async findMany() {
          return [{
            userBuilderId: "personal_1",
            cloudBuilderId: "cloud_1",
            userBuilder: { entityId: "entity_1" },
            cloudBuilder: { entityId: "entity_1" },
          }];
        },
      },
      feedItem: {
        async groupBy() {
          return [
            {
              builderId: "personal_1",
              kind: "POST",
              externalId: "same-post",
              _max: {
                publishedAt: new Date("2026-07-27T00:00:00.000Z"),
                createdAt: new Date("2026-07-27T00:01:00.000Z"),
              },
            },
            {
              builderId: "cloud_1",
              kind: "POST",
              externalId: "same-post",
              _max: {
                publishedAt: new Date("2026-07-27T00:00:00.000Z"),
                createdAt: new Date("2026-07-27T00:02:00.000Z"),
              },
            },
            {
              builderId: "cloud_1",
              kind: "VIDEO",
              externalId: "new-post",
              _max: {
                publishedAt: null,
                createdAt: new Date("2026-07-28T00:00:00.000Z"),
              },
            },
          ];
        },
      },
    },
  });

  assert.deepEqual(result.get("entity_1"), {
    count: 2,
    latestPostCreatedAt: new Date("2026-07-28T00:00:00.000Z"),
  });
});

test("imported platform-maintained channels reach the matching admin producer", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const builderQueries: unknown[] = [];
    const builders = [
      {
        id: "imported_launches",
        entityId: "entity_launches",
        sourceType: "New Product Launches",
        ownerEmail: "member@example.com",
      },
      {
        id: "admin_launches",
        entityId: "entity_launches",
        sourceType: "new-product-launches",
        ownerEmail: "admin@example.com",
      },
      {
        id: "admin_wrong_type",
        entityId: "entity_launches",
        sourceType: "blog",
        ownerEmail: "admin@example.com",
      },
      {
        id: "admin_wrong_entity",
        entityId: "entity_other",
        sourceType: "new_product_launches",
        ownerEmail: "admin@example.com",
      },
      {
        id: "member_launches",
        entityId: "entity_launches",
        sourceType: "New Product Launches",
        ownerEmail: "member@example.com",
      },
    ];

    const result = await resolveUserContentBuilderIds({
      userId: "user_1",
      logicalBuilderIds: ["imported_launches"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            builderQueries.push(args);
            const input = args as {
              where?: {
                id?: { in?: string[] };
                entityId?: { in?: string[] };
                owner?: { email?: { in?: string[] } };
              };
            };
            if (input.where?.id?.in) {
              return builders.filter((builder) => input.where?.id?.in?.includes(builder.id));
            }
            if (input.where?.entityId?.in) {
              return builders.filter((builder) =>
                input.where?.entityId?.in?.includes(builder.entityId) &&
                input.where?.owner?.email?.in?.includes(builder.ownerEmail),
              );
            }
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [];
          },
        },
      },
    });

    assert.deepEqual(result.sort(), ["admin_launches", "imported_launches"]);
    assert.equal(builderQueries.length, 2);
    assert.deepEqual(
      (builderQueries[1] as {
        where?: {
          entityId?: { in?: string[] };
          owner?: { email?: { in?: string[] } };
        };
      }).where,
      {
        entityId: { in: ["entity_launches"] },
        owner: { email: { in: ["admin@example.com"] } },
      },
    );
    assert.ok(!result.includes("admin_wrong_type"));
    assert.ok(!result.includes("admin_wrong_entity"));
    assert.ok(!result.includes("member_launches"));
  });
});

test("GitHub Trending and Product Hunt channels reach their matching admin producers", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const builders = [
      {
        id: "member_github",
        entityId: "entity_github",
        sourceType: "GitHub Trending",
        ownerEmail: "member@example.com",
      },
      {
        id: "admin_github",
        entityId: "entity_github",
        sourceType: "github_trending",
        ownerEmail: "admin@example.com",
      },
      {
        id: "member_product_hunt",
        entityId: "entity_product_hunt",
        sourceType: "Product Hunt Top Products",
        ownerEmail: "member@example.com",
      },
      {
        id: "admin_product_hunt",
        entityId: "entity_product_hunt",
        sourceType: "product-hunt-top-products",
        ownerEmail: "admin@example.com",
      },
    ];

    const result = await resolveUserContentBuilderIds({
      userId: "user_1",
      logicalBuilderIds: ["member_github", "member_product_hunt"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            const input = args as {
              where?: {
                id?: { in?: string[] };
                entityId?: { in?: string[] };
                owner?: { email?: { in?: string[] } };
              };
            };
            if (input.where?.id?.in) {
              return builders.filter((builder) => input.where?.id?.in?.includes(builder.id));
            }
            if (input.where?.entityId?.in) {
              return builders.filter((builder) =>
                input.where?.entityId?.in?.includes(builder.entityId) &&
                input.where?.owner?.email?.in?.includes(builder.ownerEmail),
              );
            }
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [];
          },
        },
      },
    });

    assert.deepEqual(result.sort(), [
      "admin_github",
      "admin_product_hunt",
      "member_github",
      "member_product_hunt",
    ]);
  });
});

test("private platform-maintained channels reach the same admin producer", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const result = await resolveUserContentBuilderIds({
      userId: "user_1",
      logicalBuilderIds: ["private_launches"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            const input = args as {
              where?: {
                id?: { in?: string[] };
                entityId?: { in?: string[] };
                owner?: { email?: { in?: string[] } };
              };
            };
            if (input.where?.id?.in?.includes("private_launches")) {
              return [
                {
                  id: "private_launches",
                  entityId: "entity_launches",
                  sourceType: "new_product_launches",
                },
              ];
            }
            if (
              input.where?.entityId?.in?.includes("entity_launches") &&
              input.where?.owner?.email?.in?.includes("admin@example.com")
            ) {
              return [
                {
                  id: "admin_launches",
                  entityId: "entity_launches",
                  sourceType: "new_product_launches",
                },
              ];
            }
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [];
          },
        },
      },
    });

    assert.deepEqual(result.sort(), ["admin_launches", "private_launches"]);
  });
});

test("imported and private platform-maintained channels dedupe one canonical post once", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const result = await loadUserContentStatsByEntityId({
      userId: "user_1",
      logicalBuilderIds: ["imported_launches", "private_launches"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            const input = args as {
              where?: {
                id?: { in?: string[] };
                entityId?: { in?: string[] };
                owner?: { email?: { in?: string[] } };
              };
            };
            if (input.where?.id?.in) {
              return [
                {
                  id: "imported_launches",
                  entityId: "entity_launches",
                  sourceType: "new_product_launches",
                },
                {
                  id: "private_launches",
                  entityId: "entity_launches",
                  sourceType: "New Product Launches",
                },
                {
                  id: "admin_launches",
                  entityId: "entity_launches",
                  sourceType: "new-product-launches",
                },
              ].filter((builder) => input.where?.id?.in?.includes(builder.id));
            }
            if (
              input.where?.entityId?.in?.includes("entity_launches") &&
              input.where?.owner?.email?.in?.includes("admin@example.com")
            ) {
              return [
                {
                  id: "admin_launches",
                  entityId: "entity_launches",
                  sourceType: "new-product-launches",
                },
              ];
            }
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [];
          },
        },
        feedItem: {
          async groupBy() {
            return [
              {
                builderId: "imported_launches",
                kind: "POST",
                externalId: "same-post",
                _max: {
                  publishedAt: new Date("2026-07-30T00:00:00.000Z"),
                  createdAt: new Date("2026-07-30T00:01:00.000Z"),
                },
              },
              {
                builderId: "private_launches",
                kind: "POST",
                externalId: "same-post",
                _max: {
                  publishedAt: new Date("2026-07-30T00:00:00.000Z"),
                  createdAt: new Date("2026-07-30T00:02:00.000Z"),
                },
              },
              {
                builderId: "admin_launches",
                kind: "POST",
                externalId: "same-post",
                _max: {
                  publishedAt: new Date("2026-07-30T00:00:00.000Z"),
                  createdAt: new Date("2026-07-30T00:03:00.000Z"),
                },
              },
              {
                builderId: "admin_launches",
                kind: "VIDEO",
                externalId: "new-post",
                _max: {
                  publishedAt: new Date("2026-07-31T00:00:00.000Z"),
                  createdAt: new Date("2026-07-31T00:01:00.000Z"),
                },
              },
            ];
          },
        },
      },
    });

    assert.deepEqual(result.get("entity_launches"), {
      count: 2,
      latestPostCreatedAt: new Date("2026-07-31T00:00:00.000Z"),
    });
  });
});

test("missing logical platform-maintained channels do not expose admin producers", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const builderQueries: unknown[] = [];
    const result = await resolveUserContentBuilderIds({
      userId: "user_1",
      logicalBuilderIds: ["deleted_launches"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            builderQueries.push(args);
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [];
          },
        },
      },
    });

    assert.deepEqual(result, []);
    assert.equal(builderQueries.length, 1);
  });
});

test("different entities or source types are never joined to platform-maintained admin producers", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const result = await resolveUserContentBuilderIds({
      userId: "user_1",
      logicalBuilderIds: ["launches_entity_1"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            const input = args as {
              where?: {
                id?: { in?: string[] };
                entityId?: { in?: string[] };
                owner?: { email?: { in?: string[] } };
              };
            };
            if (input.where?.id?.in?.includes("launches_entity_1")) {
              return [
                {
                  id: "launches_entity_1",
                  entityId: "entity_1",
                  sourceType: "new_product_launches",
                },
              ];
            }
            if (
              input.where?.entityId?.in?.includes("entity_1") &&
              input.where?.owner?.email?.in?.includes("admin@example.com")
            ) {
              return [
                {
                  id: "admin_launches_entity_1",
                  entityId: "entity_1",
                  sourceType: "new_product_launches",
                },
              ];
            }
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [];
          },
        },
      },
    });

    assert.deepEqual(result.sort(), ["admin_launches_entity_1", "launches_entity_1"]);
    assert.ok(!result.includes("admin_wrong_entity"));
    assert.ok(!result.includes("admin_wrong_type"));
  });
});

test("platform-maintained admin producers compose with existing cloud-linked expansion", async () => {
  await withAdminEmails("admin@example.com", async () => {
    const result = await resolveUserContentBuilderIds({
      userId: "user_1",
      logicalBuilderIds: ["private_launches"],
      prisma: {
        builder: {
          async findMany(args: unknown) {
            const input = args as {
              where?: {
                id?: { in?: string[] };
                entityId?: { in?: string[] };
                owner?: { email?: { in?: string[] } };
              };
            };
            if (input.where?.id?.in) {
              return [
                {
                  id: "private_launches",
                  entityId: "entity_launches",
                  sourceType: "new_product_launches",
                },
                {
                  id: "cloud_launches",
                  entityId: "entity_launches",
                  sourceType: "new_product_launches",
                },
              ].filter((builder) => input.where?.id?.in?.includes(builder.id));
            }
            if (
              input.where?.entityId?.in?.includes("entity_launches") &&
              input.where?.owner?.email?.in?.includes("admin@example.com")
            ) {
              return [
                {
                  id: "admin_launches",
                  entityId: "entity_launches",
                  sourceType: "new_product_launches",
                },
              ];
            }
            return [];
          },
        },
        cloudSourceSubmission: {
          async findMany() {
            return [
              {
                userBuilderId: "private_launches",
                cloudBuilderId: "cloud_launches",
                userBuilder: { entityId: "entity_launches" },
                cloudBuilder: { entityId: "entity_launches" },
              },
            ];
          },
        },
      },
    });

    assert.deepEqual(result.sort(), ["admin_launches", "cloud_launches", "private_launches"]);
  });
});

test("removing a reachable logical channel removes access without mutating shared admin content or other users", async () => {
  await withAdminEmails("admin@example.com", async () => {
    let userAChannelReachable = true;
    const sharedFeedRows = [
      {
        builderId: "admin_launches",
        kind: "POST",
        externalId: "launch-1",
        _max: {
          publishedAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:01:00.000Z"),
        },
      },
    ];
    const originalSharedFeedRows = sharedFeedRows.map((row) => ({
      ...row,
      _max: { ...row._max },
    }));
    const prisma = {
      builder: {
        async findMany(args: unknown) {
          const input = args as {
            where?: {
              id?: { in?: string[] };
              entityId?: { in?: string[] };
              owner?: { email?: { in?: string[] } };
            };
          };
          if (input.where?.id?.in) {
            return [
              ...(userAChannelReachable
                ? [
                    {
                      id: "user_a_launches",
                      entityId: "entity_launches",
                      sourceType: "new_product_launches",
                    },
                  ]
                : []),
              {
                id: "user_b_launches",
                entityId: "entity_launches",
                sourceType: "new_product_launches",
              },
              {
                id: "admin_launches",
                entityId: "entity_launches",
                sourceType: "new_product_launches",
              },
            ].filter((builder) => input.where?.id?.in?.includes(builder.id));
          }
          if (
            input.where?.entityId?.in?.includes("entity_launches") &&
            input.where?.owner?.email?.in?.includes("admin@example.com")
          ) {
            return [
              {
                id: "admin_launches",
                entityId: "entity_launches",
                sourceType: "new_product_launches",
              },
            ];
          }
          return [];
        },
      },
      cloudSourceSubmission: {
        async findMany() {
          return [];
        },
      },
      feedItem: {
        async groupBy() {
          return sharedFeedRows;
        },
      },
    };

    const beforeRemoval = await loadUserContentStatsByEntityId({
      userId: "user_a",
      logicalBuilderIds: ["user_a_launches"],
      prisma,
    });
    assert.deepEqual(beforeRemoval.get("entity_launches"), {
      count: 1,
      latestPostCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    userAChannelReachable = false;

    const afterRemoval = await resolveUserContentBuilderIds({
      userId: "user_a",
      logicalBuilderIds: ["user_a_launches"],
      prisma,
    });
    assert.deepEqual(afterRemoval, []);
    assert.deepEqual(sharedFeedRows, originalSharedFeedRows);

    const otherUser = await loadUserContentStatsByEntityId({
      userId: "user_b",
      logicalBuilderIds: ["user_b_launches"],
      prisma,
    });
    assert.deepEqual(otherUser.get("entity_launches"), {
      count: 1,
      latestPostCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
  });
});
