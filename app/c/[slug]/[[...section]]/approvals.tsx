'use client';
import { newCard, placeMove, workAction, undoMove } from './work-actions';
import Work, { type WorkProps } from './work';
export type ApprovalCard={id:number,title:string,go_live:string|null,review_entered_at:string|null,rejection_reason:string|null};
// "Waiting on you" (#16, ADR 0013) is the board's first column: the Inbox opens the board on it. One list for this
// person, newest first: the reviews they decide (#681) and anything else addressed to them, each opening its Card or Conversation.
export function Approvals(props:Omit<WorkProps,'workAction'|'placeMove'|'newCard'|'undoMove'|'section'|'focus'|'initialCreating'|'cardId'>) {
 return <Work {...props} workAction={workAction} placeMove={placeMove} newCard={newCard} undoMove={undoMove} section="work/board" focus="waiting" initialCreating={false}/>;
}
