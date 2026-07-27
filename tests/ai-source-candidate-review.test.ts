import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_SOURCE_REVIEW_PROPOSALS,
  type AiSourceReviewProposal,
} from "../src/lib/ai-source-candidate-review";

const EXPECTED_NAMES = [
  "One Useful Thing",
  "Chip Huyen",
  "Hamel Husain",
  "Eugene Yan",
  "Sam Altman",
  "Fei-Fei Li",
  "François Chollet",
  "SemiAnalysis",
  "AI Snake Oil",
  "fast.ai",
  "宝玉",
  "Georgi Gerganov",
  "World Labs",
  "Thinking Machines Lab",
  "Apple Machine Learning Research",
  "NVIDIA Research",
  "xAI News",
  "Qwen Blog",
  "DeepSeek Updates",
  "Ai2 News",
  "Sakana AI",
  "Nous Research",
  "Unsloth",
  "Perplexity Blog",
  "Artificial Analysis",
  "Epoch AI",
  "METR",
  "ARC Prize",
  "Demis Hassabis",
  "Yann LeCun",
  "Jim Fan",
  "Thomas Wolf",
  "Ilya Sutskever",
  "Dario Amodei",
  "Thibault Sottiaux",
  "Nan Yu",
  "Madhu Guru",
  "Amjad Masad",
  "Guillermo Rauch",
  "Aaron Levie",
  "Matt Turck",
] as const;

const EXPECTED_NEW_X_HANDLES = {
  "Thibault Sottiaux": "thsottiaux",
  "Nan Yu": "thenanyu",
  "Madhu Guru": "realmadhuguru",
  "Amjad Masad": "amasad",
  "Guillermo Rauch": "rauchg",
  "Aaron Levie": "levie",
  "Matt Turck": "mattturck",
} as const;

test("AI source review proposals lock the 41-source candidate review contract", () => {
  const proposals: readonly AiSourceReviewProposal[] = AI_SOURCE_REVIEW_PROPOSALS;

  assert.equal(proposals.length, 41);

  const actualNames = proposals.map((proposal) => proposal.name).sort();
  const expectedNames = [...EXPECTED_NAMES].sort();
  assert.deepEqual(actualNames, expectedNames);

  for (const proposal of proposals) {
    assert.ok(
      proposal.sourceType === "blog" || proposal.sourceType === "x",
      `${proposal.name} must use blog or x sourceType`,
    );
    assert.notEqual(proposal.sourceType, "website");

    const url = new URL(proposal.sourceUrl);
    assert.equal(url.protocol, "https:", `${proposal.name} must use HTTPS`);
    assert.notEqual(url.hostname, "github.com", `${proposal.name} must not use a GitHub profile`);

    if (proposal.sourceType === "x") {
      assert.ok(proposal.handle, `${proposal.name} must define a handle`);
      assert.equal(proposal.sourceUrl, `https://x.com/${proposal.handle}`);
    } else {
      assert.equal(proposal.handle, undefined, `${proposal.name} blog proposal must not define a handle`);
    }
  }

  const proposalByName = new Map<string, AiSourceReviewProposal>(
    proposals.map((proposal) => [proposal.name, proposal]),
  );

  for (const [name, handle] of Object.entries(EXPECTED_NEW_X_HANDLES)) {
    const proposal = proposalByName.get(name);
    assert.ok(proposal, `${name} proposal must exist`);
    assert.equal(proposal.sourceType, "x");
    assert.equal(proposal.handle, handle);
    assert.equal(proposal.sourceUrl, `https://x.com/${handle}`);
  }
});
