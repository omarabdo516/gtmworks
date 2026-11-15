import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { agentFace } from '@/lib/agent-face.mjs';

const drawing = (element: Element) => element.innerHTML;

test('an Agent face is a picture named for the Agent, at the size asked for', async () => {
 const screen = await render(<CompanyAgentFace agent={{ connection_id: 'c-1', name: 'Writer' }} size={40}/>);
 const face = screen.getByRole('img', { name: 'Writer' });
 await expect.element(face).toBeVisible();
 const box = face.element().getBoundingClientRect();
 expect([box.width, box.height]).toEqual([40, 40]);
});

test('one Agent always wears the same face, whatever its name or size', async () => {
 const screen = await render(<>
  <CompanyAgentFace agent={{ connection_id: 'c-1', name: 'Writer' }} size={24}/>
  <CompanyAgentFace agent={{ connection_id: 'c-1', name: 'الكاتب' }} size={48}/>
 </>);
 const [small, large] = [screen.getByRole('img', { name: 'Writer' }), screen.getByRole('img', { name: 'الكاتب' })];
 expect(drawing(small.element())).toBe(drawing(large.element()));
});

test('two Agents whose connections draw different faces look different', async () => {
 const connections = ['c-1', 'c-2', 'c-3', 'c-4'];
 const [first, other] = [connections[0], connections.find(id => JSON.stringify(agentFace(id)) !== JSON.stringify(agentFace(connections[0])))!];
 const screen = await render(<>
  <CompanyAgentFace agent={{ connection_id: first, name: 'First' }} size={32}/>
  <CompanyAgentFace agent={{ connection_id: other, name: 'Other' }} size={32}/>
 </>);
 expect(drawing(screen.getByRole('img', { name: 'First' }).element())).not.toBe(drawing(screen.getByRole('img', { name: 'Other' }).element()));
});
