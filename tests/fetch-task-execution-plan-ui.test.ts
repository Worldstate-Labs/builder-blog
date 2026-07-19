import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskRow } from "../src/components/FetchLogPanel";

test("shared TaskRow planned facts render execution budget and deadline labels for cloud post tasks", () => {
  const task = {
    id: "post_1",
    title: "Long interview episode",
    status: "failed",
    failureReason: "timeout",
    contentStatus: "ready",
    estimatedWorkSeconds: 5400,
    executionBudgetSeconds: 7200,
    workloadClass: "long_media",
    deadlineState: "at_risk",
    mediaDurationSeconds: 3600,
    plannedExtractionMethod: "audio_transcription",
    mustSucceedBy: "2026-07-19T16:00:00.000Z",
    estimateEvidence: { backend: "faster_whisper", mediaDurationSeconds: 3600 },
  } as const;

  const html = renderToStaticMarkup(
    createElement(TaskRow, {
      groupTasks: [task] as never[],
      liveTask: null,
      liveTasks: new Map(),
      task: task as never,
    }),
  );

  assert.match(html, /Work estimate/);
  assert.match(html, />1h 30m</);
  assert.match(html, /Execution budget/);
  assert.match(html, />2h</);
  assert.match(html, /Workload/);
  assert.match(html, />Long media</);
  assert.match(html, /Deadline risk/);
  assert.match(html, />At risk</);
  assert.match(html, /Must succeed by/);
  assert.match(html, /Method \/ evidence/);
  assert.match(html, /audio transcription/i);
  assert.match(html, /1h media/);
});
