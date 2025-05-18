const core = require("@actions/core");
const github = require("@actions/github");
const { Configuration, OpenAIApi } = require("openai");

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


    const prompt = `
Below is the unified diff for a GitHub pull request.

Summarize the pull request strictly following the following Korean template (양식, 항목명, 순서, 내용 모두 한국어로 작성):

${template}

Instructions:
- Your entire response must be written in Korean, including all section titles and content.
- Use clear Korean expressions as if you are explaining to a Korean developer.
- Do not translate or answer in English. Only Korean.
- Follow the above template and order exactly.

[수정 파일 목록]
{{파일목록}}

[Unified diff]
{{diff}}
    `
    .replace("{{파일목록}}", fileList)
    .replace("{{diff}}", diff);

    // GPT 호출
    const openai = new OpenAIApi(new Configuration({ apiKey: openaiApiKey }));

    const gptRes = await openai.createChatCompletion({
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You are a professional GitHub reviewer. All your answers MUST be written in Korean. Do NOT use English. Follow the user’s template and order strictly."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    });

    const answer = gptRes.data.choices[0].message.content.trim();

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
