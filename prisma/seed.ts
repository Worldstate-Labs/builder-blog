// The server-side crawler and seed functions have been removed.
// Admin uses the local CLI (builder-digest.mjs) like every other user.
async function main() {
  console.log("No seed actions configured. Use the CLI to import builders.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
