import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { AgentFace } from '@/components/agent-face';
import { MemberPicker } from '@/lib/work-activity';
import { AgentIdentitiesProvider } from '@/lib/agent-identities-client';
import { LanguageProvider } from '@/lib/i18n-client';
import { roleAgents } from '@/lib/role-agents';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/board.css';
import '@/app/settings.css';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

const writer = { id: '30000000-0000-0000-0000-000000000001', role: 'writer', name: 'وكيل المحتوى' };
const critic = { id: '30000000-0000-0000-0000-000000000005', role: 'critic', name: 'الناقد' };

test('an agent\'s face is a still picture named for it in its role\'s colour, drawn the same at every size and after a pointer passes', async () => {
 // Drawn inside the app's own stylesheets, where Home, a board card and Settings draw a face, so a rule that animates a
 // face there is caught.
 const screen = await render(<div className="gw">
  <div className="home-agents"><AgentFace {...writer} size={20}/><AgentFace {...writer} size={52}/><AgentFace {...critic} size={20}/></div>
  <div className="board-view"><div className="kcard"><span className="kcard__agent"><AgentFace {...writer}/></span></div></div>
  <div className="sov"><span className="fstack"><AgentFace {...writer}/><AgentFace {...critic}/></span></div>
 </div>);
 const faces = screen.getByRole('img').elements();
 const [small, large, other] = faces;
 const still = () => faces.flatMap(face => face.getAnimations({ subtree: true }));
 await expect.element(screen.getByRole('img', { name: 'وكيل المحتوى' }).first()).toBeVisible();
 expect(small.querySelector('g')!.getAttribute('fill')).toBe(roleAgents.find(agent => agent.key === 'writer')!.color);
 expect(still()).toEqual([]);
 expect(large.innerHTML).toBe(small.innerHTML);
 expect(other.innerHTML).not.toBe(small.innerHTML);
 await screen.getByRole('img', { name: 'وكيل المحتوى' }).first().hover();
 expect(still()).toEqual([]);
 expect(small.innerHTML).toBe(large.innerHTML);
});

test('the card\'s assignee menu shows each agent with its face, and choosing one makes it the assignee', async () => {
 const members = [{ person_id: '20000000-0000-0000-0000-000000000002', people: { name: 'Mona' } }, { person_id: writer.id, agent_role: 'writer', people: { name: writer.name } }];
 const screen = await render(<LanguageProvider language="en"><AgentIdentitiesProvider agents={[writer, critic]}>
  <aside><AgentFace {...writer}/></aside>
  <form><MemberPicker label="Add assignee" name="person" members={members}/></form>
 </AgentIdentitiesProvider></LanguageProvider>);
 const drawn = screen.getByRole('complementary').getByRole('img', { name: writer.name }).element().innerHTML;
 await screen.getByRole('button', { name: 'Add assignee' }).click();
 const option = page.getByRole('menuitemradio', { name: writer.name });
 const face = option.getByRole('img', { name: writer.name });
 await expect.element(face).toBeVisible();
 expect(face.element().innerHTML).toBe(drawn);
 await option.click();
 await expect.poll(() => new FormData(document.querySelector('form')!).get('person')).toBe(writer.id);
});
