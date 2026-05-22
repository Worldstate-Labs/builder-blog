import { crawlCentralFeeds, seedDefaultBuilderPool } from "../src/lib/builders";

async function main() {
  const seeded = await seedDefaultBuilderPool();
  const crawled = await crawlCentralFeeds();
  console.log({ seeded, crawled });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
