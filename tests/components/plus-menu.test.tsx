import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { CallableAgentsProvider, MessageBox, type CallableAgent } from '@/app/conversation-composer';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';

// #153, the composer's "+" menu (design-reference: plusMenuHTML, togglePlus, insertAtCaret, the menu's keys).
const agents = [{ id: 'a1', connection_id: 'c1', name: 'Lead' }, { id: 'a2', connection_id: 'c2', name: 'Reach' }];
const composer = (props: { call?: Parameters<typeof MessageBox>[0]['call'], attach?: boolean, seen?: CallableAgent[], language?: Language } = {}) => render(<div className="gw" style={{paddingTop: 480}}><div className="composer-area">
 <LanguageProvider language={props.language ?? 'en'}><CallableAgentsProvider agents={props.seen ?? agents}>
  <MessageBox placeholder="Write" send={async () => null} call={props.call} attach={props.attach}/>
 </CallableAgentsProvider></LanguageProvider>
</div><button type="button">Elsewhere</button></div>);

test('the "+" button opens the menu above the composer, focused on its first entry, and closes it again; its label names what the menu holds', async () => {
 const screen = await composer();
 const plus = screen.getByRole('button', { name: 'More: call someone, commands, attach' });
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');
 await expect.element(plus).toHaveAttribute('aria-haspopup', 'menu');
 await plus.click();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'true');
 const menu = screen.getByRole('menu', { name: 'More' });
 await expect.element(menu).toBeVisible();
 await expect.element(screen.getByRole('menuitem', { name: 'Lead @Lead' })).toHaveFocus();
 const [menuBox, composerBox] = [menu.element().getBoundingClientRect(), menu.element().closest('.composer')!.getBoundingClientRect()];
 expect(menuBox.bottom).toBeLessThanOrEqual(composerBox.top);
 await plus.click();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');
 await expect.element(menu).not.toBeInTheDocument();
 await expect.element(plus).toHaveFocus();
});

test('with nobody to call the label names the commands only, and "Commands" lists /agent "Ask for a new agent"', async () => {
 const screen = await composer({ seen: [] });
 await screen.getByRole('button', { name: 'More: commands, attach' }).click();
 await expect.element(screen.getByText('Call an agent')).not.toBeInTheDocument();
 await expect.element(screen.getByText('Commands')).toBeVisible();
 await expect.element(screen.getByRole('menuitem', { name: 'Ask for a new agent /agent' })).toHaveFocus();
});

test('in Arabic the menu speaks the reference\'s words', async () => {
 const screen = await composer({ language: 'ar' });
 await screen.getByRole('button', { name: 'إضافات: نادي حد، الأوامر، إرفاق' }).click();
 await expect.element(screen.getByRole('menu', { name: 'إضافات' })).toBeVisible();
 await expect.element(screen.getByText('نادي وكيل')).toBeVisible();
 await expect.element(screen.getByText('الأوامر')).toBeVisible();
 await expect.element(screen.getByRole('menuitem', { name: 'اطلب وكيل جديد /agent' })).toBeVisible();
});

test('"Commands" lists each role\'s command with the Agent this Member sees, then /agent, and a role with no Agent has none', async () => {
 // #159: Ready and Figures were made from a role (meta, numbers), Reach by hand, so only their two commands are listed.
 const seen: CallableAgent[] = [{ id: 'b1', connection_id: 'e1', name: 'Reach' }, { id: 'b2', connection_id: 'e2', name: 'Ready', role: 'meta' }, { id: 'b3', connection_id: 'e3', name: 'Figures', role: 'numbers' }];
 const screen = await composer({ seen });
 await screen.getByRole('button', { name: 'More: call someone, commands' }).click();
 const items = screen.getByRole('menuitem').elements().map(item => item.textContent);
 expect(items.filter(text => text?.includes('/'))).toEqual(['New campaign with Ready/campaign', 'Numbers summary from Figures/report', 'Ask for a new agent/agent']);
 await screen.getByRole('menuitem', { name: 'Numbers summary from Figures /report' }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('/report ');
});

test('in Arabic "Commands" names the Agent in the reference\'s words', async () => {
 const screen = await composer({ seen: [{ id: 'b1', connection_id: 'e1', name: 'محتوى', role: 'writer' }], language: 'ar' });
 await screen.getByRole('button', { name: 'إضافات: نادي حد، الأوامر' }).click();
 await expect.element(screen.getByRole('menuitem', { name: 'مقال SEO جديد من محتوى /article' })).toBeVisible();
});

test('picking an entry closes the menu and puts its text at the caret, one space after it and one before when needed, and the field takes the focus', async () => {
 const screen = await composer();
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, 'hello world');
 (field.element() as HTMLTextAreaElement).setSelectionRange(5, 5);
 await screen.getByRole('button', { name: 'More: call someone, commands, attach' }).click();
 await screen.getByRole('menuitem', { name: 'Reach @Reach' }).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(field).toHaveValue('hello @Reach  world');
 await expect.element(field).toHaveFocus();
 const area = field.element() as HTMLTextAreaElement;
 expect([area.selectionStart, area.selectionEnd]).toEqual([13, 13]);
 await screen.getByRole('button', { name: 'More: call someone, commands, attach' }).click();
 await screen.getByRole('menuitem', { name: 'Ask for a new agent /agent' }).click();
 await expect.element(field).toHaveValue('hello @Reach /agent  world');
 await expect.element(field).toHaveFocus();
 expect([area.selectionStart, area.selectionEnd]).toEqual([20, 20]);
 await userEvent.keyboard('x');
 await expect.element(field).toHaveValue('hello @Reach /agent x world');
});

test('Arrow Down and Up move through the entries and wrap, Home and End jump to the ends, Escape closes and gives the focus back to "+", Tab closes, and a click outside closes', async () => {
 const screen = await composer();
 const plus = screen.getByRole('button', { name: 'More: call someone, commands, attach' });
 const [lead, reach, command, attach] = [screen.getByRole('menuitem', { name: 'Lead @Lead' }), screen.getByRole('menuitem', { name: 'Reach @Reach' }), screen.getByRole('menuitem', { name: 'Ask for a new agent /agent' }), screen.getByRole('menuitem', { name: 'Attach a file' })];
 await plus.click();
 await expect.element(lead).toHaveFocus();
 await userEvent.keyboard('{ArrowDown}'); await expect.element(reach).toHaveFocus();
 await userEvent.keyboard('{ArrowDown}'); await expect.element(command).toHaveFocus();
 await userEvent.keyboard('{ArrowDown}'); await expect.element(attach).toHaveFocus();
 await userEvent.keyboard('{ArrowDown}'); await expect.element(lead).toHaveFocus();
 await userEvent.keyboard('{ArrowUp}'); await expect.element(attach).toHaveFocus();
 await userEvent.keyboard('{ArrowUp}'); await expect.element(command).toHaveFocus();
 await userEvent.keyboard('{ArrowUp}'); await expect.element(reach).toHaveFocus();
 await userEvent.keyboard('{Home}'); await expect.element(lead).toHaveFocus();
 await userEvent.keyboard('{End}'); await expect.element(attach).toHaveFocus();
 await userEvent.keyboard('{Escape}');
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(plus).toHaveFocus();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');

 await plus.click();
 await expect.element(lead).toHaveFocus();
 await userEvent.keyboard('{Tab}');
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');

 await plus.click();
 await expect.element(screen.getByRole('menu')).toBeVisible();
 await screen.getByRole('button', { name: 'Elsewhere' }).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');
});

test('in a channel "Call someone in the channel" lists its other Members before "Call an agent" lists its Agents', async () => {
 const screen = await composer({ call: { people: [{ id: 'p2', name: 'Sara Hassan' }], agents: [agents[1]] }, attach: false });
 await screen.getByRole('button', { name: 'More: call someone, commands' }).click();
 const menu = screen.getByRole('menu').element();
 expect([...menu.querySelectorAll('.menu__label')].map(label => label.textContent)).toEqual(['Call someone in the channel', 'Call an agent', 'Commands']);
 await expect.element(screen.getByRole('menuitem', { name: 'Sara Hassan @Sara' })).toHaveFocus();
 expect(screen.getByRole('menuitem').elements().map(item => item.textContent)).toEqual(['SSara Hassan@Sara', 'Reach@Reach', 'Ask for a new agent/agent']);
 await screen.getByRole('menuitem', { name: 'Sara Hassan @Sara' }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('@Sara ');
});
