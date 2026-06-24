import assert from "node:assert/strict";
import test from "node:test";
import { translateUiPhrase } from "../src/lib/i18n-phrases";

test("Sources page UI phrases translate while product and source names stay stable", () => {
  const shouldTranslate: Array<[string, string]> = [
    ["Sources", "信息源"],
    [
      "Copy a prompt for your Local Agent to fetch and summarize sources in your own library.",
      "复制一段 prompt，让你的 Local Agent 抓取并总结自己信息源库里的信息源。",
    ],
    ["Fetch frequency", "抓取频率"],
    ["Language", "语言"],
    ["Latest fetch", "最近抓取"],
    ["Stopped", "已停止"],
    ["N/A", "不适用"],
    ["None yet", "暂无"],
    ["Idle", "空闲"],
    ["Details", "详情"],
    [
      "Sources in your library. You control when and how to fetch and summarize them.",
      "你信息源库里的信息源。你可以控制何时以及如何抓取和总结它们。",
    ],
    ["Remove from Hub", "从 Hub 移除"],
    ["Add a source", "添加信息源"],
    ["Following", "已关注"],
    ["Show 9 more sources", "再显示 9 个信息源"],
    ["Source libraries imported from Hub.", "从 Hub 导入的信息源库。"],
    ["No imported source libraries", "还没有导入的信息源库"],
    ["Import source libraries from Hub.", "从 Hub 导入信息源库。"],
    ["Import from Hub", "从 Hub 导入"],
  ];

  for (const [source, expected] of shouldTranslate) {
    assert.equal(translateUiPhrase("zh-CN", source), expected, source);
  }

  const shouldStayStable = [
    "AI Digest",
    "Local Agent",
    "Hub",
    "anthropic.com",
    "Product Hunt Top Products",
  ];

  for (const source of shouldStayStable) {
    assert.equal(translateUiPhrase("zh-CN", source) ?? source, source, source);
  }
});
