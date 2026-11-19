import { expect, test } from 'vitest';
import { directionOf } from '@/lib/bidi';

// #307: every reply card is laid out once from its title's first strong letter, as the reference sets `dir` once on the
// card (cardHTML). Every letter is strong, in whatever script, so a script the helper has not seen before reads left to
// right; only a right-to-left script turns the card round; a title with no strong letter keeps the interface's direction.
test.each([
  ['Arabic', 'انشر مقال «كورس محاسب شامل اونلاين»', 'rtl'],
  ['Hebrew', 'פרסום הפוסט', 'rtl'],
  ['Latin', 'Publish the article', 'ltr'],
  ['Latin Extended Additional', 'Ẁhere the Vietnamese title starts', 'ltr'],
  ['Armenian', 'Հրապարակել հոդվածը', 'ltr'],
  ['CJK', '发布文章', 'ltr'],
] as const)('a title in %s sets the card %s, whatever the interface says', (_, title, direction) => {
  expect([directionOf(title, 'ltr'), directionOf(title, 'rtl')]).toEqual([direction, direction]);
});

test.each(['2026', '🎉', '— · —'] as const)('a title with no strong letter (%s) keeps the interface\'s own direction', title => {
  expect([directionOf(title, 'ltr'), directionOf(title, 'rtl')]).toEqual(['ltr', 'rtl']);
});

test.each([['SEO سابه مسودة', 'ltr'], ['مراجعة SEO', 'rtl']] as const)('the first strong letter decides the card (%s), not the script that comes later', (title, direction) => {
  expect(directionOf(title, 'rtl')).toBe(direction);
});
