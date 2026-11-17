// Model providers' registrable domains (#266): tests always talk to a fake engine, a fake Hermes or the install job's
// fake model provider, so a test or helper that names one of these hosts, or any host under them, fails the static check.
export const providerHosts = ['openai.com', 'chatgpt.com', 'anthropic.com', 'claude.ai', 'openrouter.ai', 'deepseek.com',
  'generativelanguage.googleapis.com', 'aiplatform.googleapis.com', 'mistral.ai', 'groq.com', 'x.ai', 'together.xyz',
  'together.ai', 'fireworks.ai', 'cohere.com', 'cohere.ai', 'perplexity.ai', 'nousresearch.com', 'huggingface.co'];

// A whole host only: `api.openai.com` matches, `notopenai.com` and `openai.com.example` do not.
const pattern = new RegExp(`(?<![a-z0-9.-])((?:[a-z0-9-]+\\.)*(?:${providerHosts.map(host => host.replaceAll('.', '\\.')).join('|')}))(?![a-z0-9-]|\\.[a-z0-9])`, 'gi');

export const findProviderHosts = files => files.flatMap(({ path, text }) => text.split('\n').flatMap((line, index) =>
  [...line.matchAll(pattern)].map(match => ({ path, line: index + 1, host: match[1].toLowerCase() }))));
