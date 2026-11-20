// Model providers' registrable domains (#266): tests always talk to a fake engine, a fake Hermes or the install job's
// fake model provider, so a test or helper that names one of these hosts, or any host under them, fails the static check.
// A `*` stands for part of one label, as in the regional `us-central1-aiplatform.googleapis.com`.
export const providerHosts = ['openai.com', 'chatgpt.com', 'openai.azure.com', 'anthropic.com', 'claude.ai', 'openrouter.ai',
  'deepseek.com', 'generativelanguage.googleapis.com', '*aiplatform.googleapis.com', 'bedrock*.*.amazonaws.com', 'mistral.ai',
  'groq.com', 'x.ai', 'z.ai', 'moonshot.ai', 'moonshot.cn', 'minimax.io', 'minimaxi.com', 'dashscope.aliyuncs.com',
  'githubcopilot.com', 'together.xyz', 'together.ai', 'fireworks.ai', 'cohere.com', 'cohere.ai', 'perplexity.ai',
  'nousresearch.com', 'huggingface.co',
  // Speech-to-text providers (#430).
  'deepgram.com', 'elevenlabs.io'];

// A whole host only: `api.openai.com` matches, `notopenai.com` and `openai.com.example` do not.
const pattern = new RegExp(`(?<![a-z0-9.-])((?:[a-z0-9-]+\\.)*(?:${providerHosts.map(host => host.replaceAll('.', '\\.').replaceAll('*', '[a-z0-9-]*')).join('|')}))(?![a-z0-9-]|\\.[a-z0-9])`, 'gi');

export const findProviderHosts = files => files.flatMap(({ path, text }) => text.split('\n').flatMap((line, index) =>
  [...line.matchAll(pattern)].map(match => ({ path, line: index + 1, host: match[1].toLowerCase() }))));
