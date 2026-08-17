import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";
import { translate } from "../src/lib/i18n";
import { translateUiPhrase } from "../src/lib/i18n-phrases";

test("Sources page UI phrases translate while product and source names stay stable", () => {
  const shouldTranslate: Array<[string, string]> = [
    ["Sources", "信息源"],
    [
      "Copy a prompt for your Local Agent to fetch and summarize sources in your own library.",
      "复制一段 prompt，让你的 Local Agent 抓取并总结自己信息源库里的信息源。",
    ],
    [
      "Choose FollowBrief or your own agent to fetch and summarize sources.",
      "选择 FollowBrief 或你自己的智能体来抓取和总结信息源。",
    ],
    ["Fetch frequency", "抓取频率"],
    ["source", "个信息源"],
    ["sources", "个信息源"],
    ["Language", "语言"],
    ["Latest fetch", "最近抓取"],
    ["Stopped", "已停止"],
    ["N/A", "不适用"],
    ["None yet", "暂无"],
    ["Idle", "空闲"],
    ["Details", "详情"],
    [
      "You can customize when and how to fetch and summarize sources in your library",
      "你可以自定义何时以及如何抓取和总结信息源库中的信息源",
    ],
    ["Keep private", "保持私密"],
    ["Add a source", "添加信息源"],
    ["Following", "已关注"],
    ["Favorites", "收藏"],
    ["Loading Favorites", "正在加载收藏"],
    ["No Favorites yet", "还没有收藏"],
    ["Show 9 more sources", "再显示 9 个信息源"],
    ["Collapse to the first 5 sources", "收起到前 5 个信息源"],
    ["New logs", "新日志"],
    ["Work estimate", "工作估算"],
    ["Execution budget", "执行预算"],
    ["Workload", "工作负载"],
    ["Long media", "长音视频"],
    ["Standard", "标准"],
    ["Deadline risk", "截止风险"],
    ["On time", "可按时完成"],
    ["At risk", "有延期风险"],
    ["Missed", "已错过期限"],
    ["Must succeed by", "必须在此之前成功"],
    ["Method / evidence", "方法 / 证据"],
    ["Audio transcription", "音频转写"],
    ["Captions", "字幕"],
    ["RSS show notes", "RSS 节目说明"],
    ["YouTube transcript", "YouTube 转写稿"],
    ["Fallback estimate", "后备估算"],
    ["Unknown backend", "未知后端"],
    ["Historical estimate", "历史估算"],
    ["Historical P(success)", "历史成功率"],
    ["Initial budget", "初始预算"],
    [
      "Source libraries imported from Hub are fetched and summarized by others.",
      "从 Hub 导入的信息源库由其他人抓取并生成摘要。",
    ],
    ["No imported source libraries", "还没有导入的信息源库"],
    ["Import source libraries from Hub.", "从 Hub 导入信息源库。"],
    ["Import from Hub", "从 Hub 导入"],
  ];

  for (const [source, expected] of shouldTranslate) {
    assert.equal(translateUiPhrase("zh-CN", source), expected, source);
  }

  const shouldStayStable = [
    "AI Brief",
    "Local Agent",
    "Hub",
    "anthropic.com",
    "Product Hunt Top Products",
  ];

  for (const source of shouldStayStable) {
    assert.equal(translateUiPhrase("zh-CN", source) ?? source, source, source);
  }
});

test("generated-data reset copy is translated in every supported locale", () => {
  const locales = ["zh-CN", "zh-TW", "ja", "ko", "es"] as const;
  const phrases = [
    "Generated data",
    "Delete posts, fetch logs, AI Briefs, brief logs, and personal Agent run records generated for your account. Sources, subscriptions, schedules, reads, and favorites are kept.",
    "Reset fetch and AI Brief data",
    "Reset your generated data?",
    "This deletes generated posts, fetch logs, AI Briefs, brief logs, inclusion markers, and personal Agent run records for your account only. Sources, subscriptions, schedules, reads, and favorites are kept. Type RESET to continue.",
    "Could not reset generated data.",
    "Reset 8 sources. Deleted 21 posts, 3 briefs, and 5 logs.",
  ];

  for (const locale of locales) {
    for (const phrase of phrases) {
      assert.ok(translateUiPhrase(locale, phrase), `${locale}: ${phrase}`);
    }
  }
  assert.equal(translateUiPhrase("zh-CN", "Generated data"), "生成的数据");
});

test("worker queue counts and generated task labels translate", () => {
  const phrases: Array<[string, string]> = [
    ["37 waiting", "37 个等待中"],
    ["Tweet 20817322…582930", "推文 20817322…582930"],
    ["Episode ffdR5fZTC5E", "单集 ffdR5fZTC5E"],
    ["Post (Live Video) abcdefghijklmno", "帖子（Live Video）abcdefghijklmno"],
    ["Untitled post task", "未命名帖子任务"],
  ];

  for (const [source, expected] of phrases) {
    assert.equal(translateUiPhrase("zh-CN", source), expected, source);
  }
});

test("pending source token and deferral summaries translate when values are formatted inline", () => {
  const cases = [
    {
      locale: "zh-CN" as const,
      source: "Estimated 1,200 tokens",
      expected: "估算 1,200 tokens",
    },
    {
      locale: "zh-CN" as const,
      source: "Remaining 50 tokens",
      expected: "剩余 50 tokens",
    },
    {
      locale: "zh-CN" as const,
      source: "Deferrals 3",
      expected: "延后次数 3",
    },
    {
      locale: "zh-TW" as const,
      source: "Estimated 1,200 tokens",
      expected: "估算 1,200 tokens",
    },
    {
      locale: "zh-TW" as const,
      source: "Remaining 50 tokens",
      expected: "剩餘 50 tokens",
    },
    {
      locale: "zh-TW" as const,
      source: "Deferrals 3",
      expected: "延後次數 3",
    },
    {
      locale: "ja" as const,
      source: "Estimated 1,200 tokens",
      expected: "推定 1,200 tokens",
    },
    {
      locale: "ja" as const,
      source: "Remaining 50 tokens",
      expected: "残り 50 tokens",
    },
    {
      locale: "ja" as const,
      source: "Deferrals 3",
      expected: "延期回数 3",
    },
    {
      locale: "ko" as const,
      source: "Estimated 1,200 tokens",
      expected: "예상 1,200 tokens",
    },
    {
      locale: "ko" as const,
      source: "Remaining 50 tokens",
      expected: "남은 50 tokens",
    },
    {
      locale: "ko" as const,
      source: "Deferrals 3",
      expected: "연기 횟수 3",
    },
    {
      locale: "es" as const,
      source: "Estimated 1,200 tokens",
      expected: "Estimado 1,200 tokens",
    },
    {
      locale: "es" as const,
      source: "Remaining 50 tokens",
      expected: "Restante 50 tokens",
    },
    {
      locale: "es" as const,
      source: "Deferrals 3",
      expected: "Aplazamientos 3",
    },
  ];

  for (const { locale, source, expected } of cases) {
    assert.equal(translateUiPhrase(locale, source), expected, `${locale}: ${source}`);
  }
});

test("visible app TSX phrases have translations for supported non-English locales", () => {
  const locales = ["zh-CN", "zh-TW", "ja", "ko", "es"] as const;
  const files = execSync("rg --files src | rg '\\.(tsx)$'", { encoding: "utf8" })
    .trim()
    .split(/\n/u)
    .filter((file) => file && !file.includes(".stories."));
  const visibleNames = new Set([
    "aria-label",
    "ariaLabel",
    "alt",
    "body",
    "buttonLabel",
    "copy",
    "description",
    "emptyBody",
    "emptyMessage",
    "emptyText",
    "emptyTitle",
    "fallback",
    "heading",
    "headingText",
    "kicker",
    "label",
    "message",
    "placeholder",
    "prefix",
    "summary",
    "text",
    "title",
  ]);
  const stableProductPhrases = new Set([
    "AI Brief",
    "Apple",
    "Claude Code",
    "Codex",
    "DELETE",
    "Deutsch (German)",
    "DigestRun",
    "English",
    "Español (Spanish)",
    "FollowBrief",
    "Français (French)",
    "GitHub",
    "GitHub Trending",
    "Google",
    "Hub",
    "Local Agent",
    "OpenAI",
    "OpenClaw",
    "Product Hunt",
    "RESET",
    "中文 (Chinese)",
    "日本語 (Japanese)",
    "한국어 (Korean)",
  ]);
  const missing: Array<string> = [];

  function clean(value: string) {
    return value.replace(/\s+/gu, " ").trim();
  }

  function record(phrase: string, location: string) {
    const normalized = clean(phrase);
    if (!/[A-Za-z]/u.test(normalized) || normalized.length <= 1) return;
    if (stableProductPhrases.has(normalized)) return;
    if (/^[a-z0-9_-]+$/iu.test(normalized)) return;
    if (/^\/[a-z0-9/?=&._-]+$/iu.test(normalized)) return;
    if (/^https?:\/\//iu.test(normalized)) return;
    if (/^[A-Z_]+$/u.test(normalized)) return;
    for (const locale of locales) {
      if (!translateUiPhrase(locale, normalized)) {
        missing.push(`${location}: ${locale}: ${normalized}`);
      }
    }
  }

  function getPropertyName(name: ts.PropertyName | undefined) {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    return null;
  }

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function location(node: ts.Node) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      return `${file}:${position.line + 1}`;
    }

    function visit(node: ts.Node) {
      if (ts.isJsxText(node)) {
        record(node.getText(sourceFile), location(node));
      }
      if (ts.isJsxAttribute(node) && visibleNames.has(node.name.getText(sourceFile))) {
        const initializer = node.initializer;
        if (initializer && ts.isStringLiteral(initializer)) {
          record(initializer.text, `${location(node)} ${node.name.getText(sourceFile)}`);
        }
      }
      if (ts.isPropertyAssignment(node)) {
        const name = getPropertyName(node.name);
        if (name && visibleNames.has(name) && ts.isStringLiteralLike(node.initializer)) {
          record(initializerText(node.initializer), `${location(node)} ${name}`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(missing, []);
});

test("Favorites tab and home copy are localized by locale keys", () => {
  assert.equal(translate("zh-CN", "tabs.favorites"), "收藏");
  assert.equal(translate("zh-TW", "tabs.favorites"), "收藏");
  assert.equal(translate("ja", "tabs.favorites"), "お気に入り");
  assert.equal(translate("ko", "tabs.favorites"), "즐겨찾기");
  assert.equal(translate("es", "tabs.favorites"), "Favoritos");
  assert.equal(
    translate("zh-CN", "home.step3Copy"),
    "两分钟速览摘要，翻看关注动态，把值得深读的内容保存下来。一切都可搜索。",
  );
});

test("Not completed phrase translations cover every supported non-English locale", () => {
  assert.equal(translateUiPhrase("zh-CN", "Not completed"), "未完成");
  assert.equal(translateUiPhrase("zh-TW", "Not completed"), "未完成");
  assert.equal(translateUiPhrase("ja", "Not completed"), "未完了");
  assert.equal(translateUiPhrase("ko", "Not completed"), "완료되지 않음");
  assert.equal(translateUiPhrase("es", "Not completed"), "No completado");
});

test("six-hour extraction ceiling copy is translated in every supported locale", () => {
  const phrase = "The planned extraction workload exceeded the supported six-hour execution ceiling, so the run stopped before attempting extraction.";

  assert.equal(
    translateUiPhrase("zh-CN", phrase),
    "计划的提取工作量超过了支持的六小时执行上限，因此任务在开始提取前就已停止。",
  );
  assert.equal(
    translateUiPhrase("zh-TW", phrase),
    "規劃的擷取工作量超過支援的六小時執行上限，因此任務在開始擷取前就已停止。",
  );
  assert.equal(
    translateUiPhrase("ja", phrase),
    "計画された抽出処理量が対応可能な6時間の実行上限を超えたため、抽出を開始する前に停止しました。",
  );
  assert.equal(
    translateUiPhrase("ko", phrase),
    "계획된 추출 작업량이 지원되는 6시간 실행 한도를 초과하여 추출을 시작하기 전에 중단되었습니다.",
  );
  assert.equal(
    translateUiPhrase("es", phrase),
    "La carga de extracción planificada superó el límite de ejecución admitido de seis horas, por lo que se detuvo antes de iniciar la extracción.",
  );
});

function initializerText(node: ts.StringLiteralLike) {
  return node.text;
}
