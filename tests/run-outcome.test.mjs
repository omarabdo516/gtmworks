import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEnd } from '../lib/run-outcome.mjs';

// #879: how a Conversation's Run ended, as its live read tells the page, read from the Run's own record on the Engine.
const state=(fields)=>({reply:null,session:null,usage:null,toolCalls:[],...fields});

test('a Run still working has no end yet, nor one the Engine did not answer for',()=>{
 assert.equal(runEnd(state({state:'running'})),null);
 assert.equal(runEnd(state({state:'unreachable'})),null);
});

test('a finished Run ended, and one the Engine no longer knows is gone',()=>{
 assert.deepEqual(runEnd(state({state:'completed',reply:'Done.'})),{end:'ended'});
 assert.deepEqual(runEnd(state({state:'lost'})),{end:'gone'});
});

test('a failed or stopped Run did not finish, with its cause when the Engine names one',()=>{
 assert.deepEqual(runEnd(state({state:'failed'})),{end:'ended',outcome:'failed'});
 assert.deepEqual(runEnd(state({state:'stopped'})),{end:'ended',outcome:'stopped'});
 assert.deepEqual(runEnd(state({state:'failed',noModel:true})),{end:'ended',outcome:'failed',cause:'noModel'});
 assert.deepEqual(runEnd(state({state:'failed',modelRefused:'credit'})),{end:'ended',outcome:'failed',cause:'credit'});
});

test('a Run that ran out of usage says when it resets',()=>{
 const resetsAt='2026-12-03T19:24:00.000Z';
 assert.deepEqual(runEnd(state({state:'failed',modelRefused:'access',resetsAt})),{end:'ended',outcome:'failed',cause:'access',resetsAt});
});
