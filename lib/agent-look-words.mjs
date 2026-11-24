// The parts of an Agent's look and the values of each, in the order the window shows them and the database lists them
// (public.agent_look_choices, #696), with the catalogue keys that name them (#698): the window, the Look row in
// Settings and the Activity log say a look in the same words.
export const lookChoices = {
 shape: ['circle', 'squircle', 'blob'],
 colour: ['indigo', 'violet', 'sky', 'teal', 'jade', 'rose', 'dusk', 'slate'],
 temperament: ['calm', 'energetic', 'warm', 'dreamy', 'neat', 'caring'],
};
const cap = value => value.charAt(0).toUpperCase() + value.slice(1);
/** The part's own name: Shape, Colour, Temperament (lookShape …), and in a sentence (logLookShape …). */
export const lookPartKey = (part, inSentence = true) => `${inSentence ? 'logLook' : 'look'}${cap(part)}`;
/** A value's name: a shape, a colour, or a temperament's short name ("Calm"). */
export const lookValueKey = (part, value) => `look${cap(part)}${cap(value)}`;
/** A temperament's full name on its tile ("Calm, confident") and its one line under the tiles. */
export const temperamentNameKey = value => `${lookValueKey('temperament', value)}Name`;
export const temperamentSayKey = value => `${lookValueKey('temperament', value)}Say`;
