// How a search in the interface compares text (the reference's arNorm, design-reference/app.js): case aside, and in
// Arabic without its marks or tatweel, with every hamza seat read as its letter (أ إ آ as alef, ؤ as waw, ئ as ya), alef
// wasla as alef, alef maqsura as ya and teh marbuta as ha. Runs of spaces are one space, and the ends are trimmed.
// Both sides of a comparison go through it: the Apps search (#201) and Find a setting (#613).
const letters = { 0x671: 0x627, 0x649: 0x64A, 0x629: 0x647 };
export const searchFold = text => String(text).toLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '')
  .replace(/[ٱىة]/g, letter => String.fromCharCode(letters[letter.charCodeAt(0)])).replace(/\s+/g, ' ').trim();
