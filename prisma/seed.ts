import { importFollowBuildersFeeds, seedDefaultBuilderPool } from "../src/lib/builders";

async function main() {
  const seeded = await seedDefaultBuilderPool();
  const imported = await importFollowBuildersFeeds();
  console.log({ seeded, imported });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
