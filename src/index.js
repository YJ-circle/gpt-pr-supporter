const core = require("@actions/core");
const github = require("@actions/github");
const OpenAI = require("openai");

async function run() {
  try {
    const token = core.getInput("token", { required: true });
    const openaiApiKey = core.getInput("openai_api_key", { required: true });
    const model = core.getInput("model", { required: true }) || "gpt-4o";
    const template = core.getInput("template", { required: true });

    const context = github.context;
    if (!context.payload.pull_request) {
      core.setFailed("이 액션은 PR 이벤트에서만 동작합니다.");
      return;
    }
    const prNumber = context.payload.pull_request.number;
    const [owner, repo] = context.repo.owner && context.repo.repo
      ? [context.repo.owner, context.repo.repo]
      : context.payload.repository.full_name.split("/");

    const octokit = github.getOctokit(token);

    // 파일 목록
    let files = [];
    let page = 1;
    let response;
    do {
      response = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
        page
      });
      files = files.concat(response.data);
      page++;
    } while (response.data.length === 100);

    // diff
    const diffResponse = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" }
    });
    const diff = diffResponse.data;

    const fileList = files.map(f => `- ${f.filename}`).join('\n');

    // 프롬프트 조립
    const prompt = template
      .replace("{{파일목록}}", fileList)
      .replace("{{diff}}", diff);

    // === openai 4.x 방식 ===
    const openai = new OpenAI({
      apiKey: openaiApiKey
    });

    const gptRes = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: `
Answer ONLY in Korean and ONLY in markdown.
Strictly follow the user’s template, order, and section titles.
NEVER add, change, remove, or reorder main sections or numbers (like 1., 2., 3.).
For sublists, use sub-numbers (1-1, 1-2) or bullets. Do NOT use main numbers.
Do not translate to English. Use concise language.
`.trim()
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 5000,
      temperature: 0.3
    });

    const answer = gptRes.choices[0].message.content.trim();

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: answer
    });

    core.info("PR 요약 코멘트 완료");

  } catch (err) {
    core.setFailed(err.message);
    console.error(err);
  }
}

run();
