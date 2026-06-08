import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Server-side include expansion for skill job prompts. Lets the library
// job prompts (library-once.md, library-cron.md) share ONE copy of the
// fetch-task / summarize execution contract instead of duplicating it.
//
// Directive syntax inside a prompt:
//   {{INCLUDE:fetch-task-contract REPORT_TARGET="the user" TMP_JOB="library-once"}}
//
// The named fragment is loaded, its own placeholders ({{REPORT_TARGET}})
// are substituted from the directive's params, and the directive is
// replaced with the result. Prompts with no directive pass through
// unchanged, so this is safe to call on every served file.

const FRAGMENTS: Record<string, string> = {
  "fetch-task-contract": "skills/builder-blog-digest/jobs/_fetch-task-contract.md",
  "digest-task-contract": "skills/builder-blog-digest/jobs/_digest-task-contract.md",
};

const INCLUDE_DIRECTIVE = /\{\{INCLUDE:([a-z0-9-]+)([^}]*)\}\}/g;
const PARAM = /([A-Z_]+)="([^"]*)"/g;
const LEADING_HTML_COMMENT = /^\s*<!--[\s\S]*?-->\s*/;

function parseParams(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = PARAM.exec(raw)) !== null) {
    params[match[1]] = match[2];
  }
  return params;
}

/**
 * Expand all {{INCLUDE:...}} directives in `content`. Async because each
 * fragment is read from disk. Unknown fragment names throw so a typo
 * surfaces at request time rather than silently shipping a broken prompt.
 */
export async function expandSkillIncludes(content: string): Promise<string> {
  // Collect directives first (regex + async replace don't mix).
  const directives = [...content.matchAll(INCLUDE_DIRECTIVE)];
  if (directives.length === 0) return content;

  let out = content;
  for (const directive of directives) {
    const [whole, name, paramsRaw] = directive;
    const fragmentPath = FRAGMENTS[name];
    if (!fragmentPath) {
      throw new Error(`Unknown skill include fragment: "${name}"`);
    }
    const params = parseParams(paramsRaw ?? "");
    let fragment = await readFile(join(process.cwd(), fragmentPath), "utf8");
    // Drop the fragment's own leading HTML-comment explainer — it's for
    // maintainers, not the agent.
    fragment = fragment.replace(LEADING_HTML_COMMENT, "");
    fragment = fragment
      .replaceAll("{{REPORT_TARGET}}", params.REPORT_TARGET ?? "")
      .replaceAll("{{TMP_JOB}}", params.TMP_JOB ?? "")
      .trim();
    out = out.replace(whole, fragment);
  }
  return out;
}
