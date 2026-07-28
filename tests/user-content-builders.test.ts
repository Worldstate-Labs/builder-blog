import assert from "node:assert/strict";
import test from "node:test";

import {
  loadUserContentStatsByEntityId,
  resolveUserContentBuilderIds,
} from "../src/lib/user-content-builders";

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
