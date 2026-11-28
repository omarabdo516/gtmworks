import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionedAgent } from '../lib/composer-mentions.mjs';

// #153: a new chat's first message goes to the Agent it calls, read as the channel reads a call
// (public.channel_mention, supabase/migrations/20261219000000_general_channel.sql), among the Agents the sender sees.
const agents=[{id:'lead',name:'Lead',is_default:true},{id:'writer',name:'Lead Writer',is_default:false},{id:'reach',name:'Reach',is_default:false},{id:'ads',name:'Meta Ads',is_default:false}];

test('"@" and a name the sender sees, in any case, between spaces, punctuation or the ends, calls that Agent',()=>{
 assert.equal(mentionedAgent('@Reach plan the week',agents),'reach');
 assert.equal(mentionedAgent('Please, @reach: plan it',agents),'reach');
 assert.equal(mentionedAgent('ممكن يا @Reach، تخطط الأسبوع',agents),'reach');
 assert.equal(mentionedAgent('ask @Meta Ads',agents),'ads');
});

test('a name inside a longer word, an email, or a name nobody sees calls no Agent',()=>{
 assert.equal(mentionedAgent('@Reacher plan it',agents),null);
 assert.equal(mentionedAgent('mail me at sara@reach.example',agents),null);
 assert.equal(mentionedAgent('@Hidden plan it',agents),null);
 assert.equal(mentionedAgent('plan the week',agents),null);
});

test('the earliest call wins, and at one place the longest name',()=>{
 assert.equal(mentionedAgent('@Reach then @Meta Ads',agents),'reach');
 assert.equal(mentionedAgent('@Lead Writer draft it',agents),'writer');
 assert.equal(mentionedAgent('@Lead draft it',agents),'lead');
});
