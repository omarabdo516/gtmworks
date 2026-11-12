// The library: skills a team can install in one click. Each entry is a complete SKILL.md and goes through the same check as an upload.
const skill = (name, description, permissions, steps) => ({ name, description, content: `---\nname: ${name}\ndescription: ${description}\npermissions: ${permissions}\n---\n\n# ${name}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n` });
export const skillLibrary = [
 skill('caption-hooks', 'Opens every caption with a hook built from one reader problem.', 'cards.read', [
  'Read the card brief and the offering and segment it names.',
  'Name the one problem of that segment this post answers.',
  'Write three hook lines of at most 12 words. Each opens with the problem or a number, never with the company name.',
  'Keep the strongest hook first, then write the caption in the company voice and inside its content rules.',
  'Never promise a result that a content rule forbids.',
 ]),
 skill('brand-voice-check', 'Checks a caption against the company voice and content rules before a person sees it.', 'cards.read, cards.write', [
  'Read the caption and the company voice and content rules.',
  'List every sentence that breaks a rule or leaves the voice, with the rule it breaks.',
  'Comment on the card with that list. Say plainly when nothing is wrong.',
  'Never approve or reject the post: a person decides.',
 ]),
 skill('post-visual-brief', 'Turns an approved caption into a short visual brief for the design.', 'cards.read, files.read', [
  'Read the approved caption and the reference images attached to the card.',
  'State the one idea the image must carry, the format and the text that goes on it.',
  'List what to keep from the references and what to avoid.',
  'Keep the brief under 120 words.',
 ]),
];
