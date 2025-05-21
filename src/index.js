const core   = require("@actions/core");
const github = require("@actions/github");
const OpenAI = require("openai");

async function run() {
  try {
    const token        = core.getInput("token",          { required: true });
    const openaiApiKey = core.getInput("openai_api_key", { required: true });
    const model        = core.getInput("model") || "gpt-4o";
    const userTemplate = (core.getInput("template") || "").trim();

    const defaultSystemPrompt = `
You are a seasoned GitHub PR review assistant.

Task: From the given git diff, output Korean markdown with exactly the four numbered sections:
1. 주요 변경 요약
2. 변경된 코드 흐름 요약
3. 위험·검토 포인트
4. 리뷰 가이드

Rules
• Keep headings & order exactly as above.
• Use concise bullets; sub-items with "-" or "1-1".
• No file-by-file detail.
• Answer only in Korean.
`.trim();
    const systemPrompt = core.getInput("system_prompt") || defaultSystemPrompt;

    const { payload, repo: ctxRepo } = github.context;
    if (!payload.pull_request) {
      core.setFailed("This action runs only on pull_request events.");
      return;
    }
    const prNumber = payload.pull_request.number;
    const [owner, repo] =
      ctxRepo.owner && ctxRepo.repo
        ? [ctxRepo.owner, ctxRepo.repo]
        : payload.repository.full_name.split("/");

    const octokit = github.getOctokit(token);

    const { data: diff } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" }
    });

    let files = [];
    let page = 1, resp;
    do {
      resp = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
        page
      });
      files = files.concat(resp.data);
      page++;
    } while (resp.data.length === 100);

    const fileList = files.map(f => `- ${f.filename}`).join("\n");

    let userPrompt;
    if (userTemplate.includes("{{diff}}") || userTemplate.includes("{{file_list}}")) {
      userPrompt = userTemplate
        .replace("{{file_list}}", fileList)
        .replace("{{diff}}", diff);
    } else {
      const autoBlocks = [
        "### Changed files",
        fileList,
        "### Diff",
        "```diff",
        diff,
        "```"
      ].join("\n");
      userPrompt = (userTemplate ? userTemplate + "\n\n" : "") + autoBlocks;
    }

    const openai = new OpenAI({ apiKey: openaiApiKey });

    const completion = await openai.chat.completions.create({
      model,
      max_tokens: 3000,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   }
      ]
    });

    const answer = completion.choices[0].message.content.trim();

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: answer
    });

    core.info("PR summary comment posted");
  } catch (err) {
    core.setFailed(err.message);
    console.error(err);
  }
}

run();
